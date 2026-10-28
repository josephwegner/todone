import { readonly, shallowRef } from 'vue';
import { AuthSessionUnavailableError, type AuthClient } from '../services/authClient';
import type { MembershipFailure } from '../../shared/membershipContract';
import type { AuthActionResult, AuthSession, SignInResult } from '../services/authClient';
import type { CurrentMembership } from '../services/householdClient';
import type { Profile } from '../services/profileClient';
import type { AuthenticatedRequestSession } from '../services/apiClient';
import { CurrentMembershipApi, SessionApiFailureCode } from '../../shared/membershipContract';
import { messages } from '../i18n/messages';
import { AuthStorageUnavailableError } from '../services/authSessionErrors';
import {
  SessionDiagnosticOperation,
  SessionDiagnosticOutcome,
  safeSessionDiagnostic,
  type SessionDiagnostic,
} from './diagnostics';
import {
  SessionCredentialsUnavailableError,
  SessionOperationCancelledError,
} from './sessionErrors';
import {
  MAX_BROWSER_TIMER_DELAY_MS,
  SESSION_EXPIRY_SKEW_MS,
  SESSION_RENEWAL_BACKOFF_MS,
  SESSION_MAX_AUTOMATIC_RETRIES,
  SESSION_CONTEXT_FRESHNESS_MS,
} from './timing';

export type SessionContext =
  | { kind: 'unattached' }
  | { kind: 'profile-required'; membership: CurrentMembership }
  | { kind: 'active'; membership: CurrentMembership; profile: Profile };

export type SessionFailure =
  | MembershipFailure
  | 'provider-unavailable'
  | 'context-unavailable'
  | 'storage-unavailable'
  | 'session-ended';
export type SessionState =
  | { kind: 'uninitialized' }
  | { kind: 'initializing' }
  | {
      kind: 'signed-out';
      reason:
        'explicit' | 'missing' | 'ended' | 'credentials-stale' | 'upgrade' | 'sign-out-incomplete';
    }
  | { kind: 'ready'; context: SessionContext; resolvedAt: number }
  | { kind: 'recoverable-error'; failure: SessionFailure };

export type SessionProviderResult =
  | { kind: 'usable'; credentials: AuthSession; browserGeneration?: string }
  | { kind: 'signed-out'; reason?: 'ended' | 'upgrade'; browserGeneration?: string }
  | { kind: 'error'; failure: SessionFailure; browserGeneration?: string };

export interface SessionProvider {
  restore(): Promise<SessionProviderResult>;
  renew?(force?: boolean): Promise<SessionProviderResult>;
  signIn(
    username: string,
    password: string,
    newPassword?: string,
  ): Promise<(SignInResult & { browserGeneration?: string }) | { kind: 'cancelled' }>;
  signOut(
    reason?: 'explicit' | 'ended' | 'credentials-stale',
    expectedGeneration?: string,
  ): void | Promise<void | { browserGeneration: string; signedOut: boolean }>;
}

export interface SessionClock {
  now(): number;
}
export type SessionContextResult =
  { kind: 'success'; context: SessionContext } | { kind: 'error'; failure: SessionFailure };

export interface SessionDependencies {
  provider: SessionProvider;
  readContext(credentials: AuthSession, signal: AbortSignal): Promise<SessionContextResult>;
  clock?: SessionClock;
  foreground?(): boolean;
  readBrowserGeneration?(): string | null;
  diagnostics?(event: SessionDiagnostic): void;
  clearPrivateState?(): void;
  account?: Pick<
    AuthClient,
    | 'registerFirstParent'
    | 'confirmRegistration'
    | 'resendConfirmationCode'
    | 'forgotPassword'
    | 'confirmForgotPassword'
  > &
    Partial<Pick<AuthClient, 'verifyEmailAttribute'>>;
}

/** One lifecycle owner per app. Credentials stay outside readonly presentation state. */
export function createSessionController(dependencies: SessionDependencies) {
  const state = shallowRef<SessionState>({ kind: 'uninitialized' });
  const clock = dependencies.clock ?? { now: () => Date.now() };
  let generation = 0;
  let disposed = false;
  let pendingInitialization: Promise<void> | null = null;
  let abortController = new AbortController();
  let credentials: AuthSession | null = null;
  const identityVersion = shallowRef(0);
  const backgroundFailure = shallowRef<SessionFailure | null>(null);
  let pendingRenewal: Promise<string> | null = null;
  let renewalTimer: ReturnType<typeof setTimeout> | undefined;
  let automaticRetries = 0;
  let pendingContextRefresh: Promise<void> | null = null;
  let contextVersion = 0;
  let observedBrowserGeneration: string | null = null;
  let contextTimer: ReturnType<typeof setTimeout> | undefined;

  function isCurrent(captured: number): boolean {
    return !disposed && captured === generation;
  }

  function diagnosticOutcome(captured: number): SessionDiagnostic['outcome'] {
    if (!isCurrent(captured)) return SessionDiagnosticOutcome.cancelled;
    if (backgroundFailure.value || state.value.kind === 'recoverable-error')
      return SessionDiagnosticOutcome.recoverableFailure;
    if (state.value.kind === 'signed-out') return SessionDiagnosticOutcome.signedOut;
    return SessionDiagnosticOutcome.success;
  }
  function recordDiagnostic(
    operation: SessionDiagnostic['operation'],
    outcome: SessionDiagnostic['outcome'],
    startedAt: number,
  ): void {
    const event = safeSessionDiagnostic({
      operation,
      outcome,
      durationMs: clock.now() - startedAt,
    });
    try {
      if (event) dependencies.diagnostics?.(event);
    } catch {
      /* Diagnostics cannot block privacy or session recovery. */
    }
  }

  function browserIdentityMatches(): boolean {
    if (!dependencies.readBrowserGeneration) return true;
    try {
      return dependencies.readBrowserGeneration() === observedBrowserGeneration;
    } catch {
      return false;
    }
  }

  function acceptBrowserGeneration(value?: string): boolean {
    if (value === undefined || !dependencies.readBrowserGeneration) return true;
    try {
      if (dependencies.readBrowserGeneration() !== value) {
        void reconcileBrowserAccount();
        return false;
      }
      observedBrowserGeneration = value;
      return true;
    } catch {
      void reconcileBrowserAccount();
      return false;
    }
  }

  async function reconcileBrowserAccount(): Promise<void> {
    if (disposed || !dependencies.readBrowserGeneration) return;
    if (pendingInitialization && observedBrowserGeneration === null) await pendingInitialization;
    if (disposed) return;
    try {
      const hadPrivateContext = state.value.kind === 'ready';
      const current = dependencies.readBrowserGeneration();
      if (current === observedBrowserGeneration) return;
      invalidate();
      identityVersion.value += 1;
      clearPrivateState();
      observedBrowserGeneration = current;
      state.value = { kind: 'uninitialized' };
      await initialize();
      const resolved = state.value as SessionState;
      if (hadPrivateContext && resolved.kind === 'signed-out' && resolved.reason === 'missing')
        state.value = { kind: 'signed-out', reason: 'explicit' };
    } catch {
      invalidate();
      identityVersion.value += 1;
      clearPrivateState();
      state.value = { kind: 'recoverable-error', failure: 'storage-unavailable' };
    }
  }

  function invalidate(): number {
    generation += 1;
    abortController.abort();
    abortController = new AbortController();
    pendingInitialization = null;
    credentials = null;
    pendingRenewal = null;
    backgroundFailure.value = null;
    clearTimeout(renewalTimer);
    automaticRetries = 0;
    pendingContextRefresh = null;
    clearTimeout(contextTimer);
    return generation;
  }

  function clearPrivateState(): void {
    // A consumer cleanup exception must not retain controller-owned identity.
    try {
      dependencies.clearPrivateState?.();
    } catch {
      /* Local privacy cleanup continues. */
    }
  }

  async function resolveContext(currentCredentials: AuthSession, captured: number): Promise<void> {
    credentials = currentCredentials;
    try {
      const result = await dependencies.readContext(currentCredentials, abortController.signal);
      if (!isCurrent(captured)) return;
      if (!browserIdentityMatches()) {
        void reconcileBrowserAccount();
        return;
      }
      if (result.kind === 'error') {
        if (result.failure === 'credentials-stale' || result.failure === 'session-ended') {
          endSession(result.failure === 'credentials-stale' ? 'credentials-stale' : 'ended');
          return;
        }
        state.value = { kind: 'recoverable-error', failure: result.failure };
        return;
      }
      state.value = { kind: 'ready', context: result.context, resolvedAt: clock.now() };
      scheduleRenewal();
      scheduleContextRefresh();
    } catch {
      if (isCurrent(captured))
        state.value = { kind: 'recoverable-error', failure: 'context-unavailable' };
    }
  }

  function initialize(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pendingInitialization) return pendingInitialization;
    if (state.value.kind !== 'uninitialized' && state.value.kind !== 'recoverable-error')
      return Promise.resolve();
    const captured = generation;
    const startedAt = clock.now();
    state.value = { kind: 'initializing' };
    const operation = (async () => {
      try {
        const result = await dependencies.provider.restore();
        if (!isCurrent(captured)) return;
        if (!acceptBrowserGeneration(result.browserGeneration)) return;
        if (result.kind === 'signed-out') {
          if (result.reason === 'ended') {
            endSession('ended');
            return;
          }
          credentials = null;
          state.value = { kind: 'signed-out', reason: result.reason ?? 'missing' };
          clearPrivateState();
          return;
        }
        if (result.kind === 'error') {
          state.value = { kind: 'recoverable-error', failure: result.failure };
          return;
        }
        await resolveContext(result.credentials, captured);
      } catch {
        if (isCurrent(captured))
          state.value = { kind: 'recoverable-error', failure: 'provider-unavailable' };
      }
    })();
    const tracked = operation.finally(() => {
      recordDiagnostic(SessionDiagnosticOperation.startup, diagnosticOutcome(captured), startedAt);
      if (pendingInitialization === tracked) pendingInitialization = null;
    });
    pendingInitialization = tracked;
    return tracked;
  }

  async function signIn(
    username: string,
    password: string,
    newPassword?: string,
  ): Promise<AuthActionResult | { kind: 'cancelled' }> {
    if (disposed) return { kind: 'cancelled' };
    const captured = invalidate();
    if (state.value.kind === 'ready') {
      identityVersion.value += 1;
      state.value = { kind: 'initializing' };
    }
    clearPrivateState();
    try {
      const result = await dependencies.provider.signIn(username, password, newPassword);
      if (!isCurrent(captured)) return { kind: 'cancelled' };
      if (result.kind === 'cancelled') {
        await reconcileBrowserAccount();
        return result;
      }
      if (result.kind === 'error') {
        if (!browserIdentityMatches()) {
          await reconcileBrowserAccount();
          return { kind: 'cancelled' };
        }
        state.value = { kind: 'signed-out', reason: 'missing' };
        return result;
      }
      if (!acceptBrowserGeneration(result.browserGeneration)) return { kind: 'cancelled' };
      identityVersion.value += 1;
      state.value = { kind: 'initializing' };
      await resolveContext(result.session, captured);
      if (!isCurrent(captured)) return { kind: 'cancelled' };
      return { kind: 'success' };
    } catch (error) {
      if (!isCurrent(captured)) return { kind: 'cancelled' };
      state.value = {
        kind: 'recoverable-error',
        failure:
          error instanceof AuthStorageUnavailableError
            ? 'storage-unavailable'
            : 'provider-unavailable',
      };
      return { kind: 'error', message: messages.generic.networkError, recoverable: true };
    }
  }

  function endSession(reason: 'explicit' | 'ended' | 'credentials-stale'): void {
    invalidate();
    identityVersion.value += 1;
    state.value = { kind: 'signed-out', reason };
    clearPrivateState();
    recordDiagnostic(
      SessionDiagnosticOperation.invalidation,
      SessionDiagnosticOutcome.signedOut,
      clock.now(),
    );
    try {
      const captured = generation;
      const cleanup = dependencies.provider.signOut(reason, observedBrowserGeneration ?? undefined);
      void Promise.resolve(cleanup)
        .then((result) => {
          if (!isCurrent(captured) || !result) return;
          if (result.signedOut) observedBrowserGeneration = result.browserGeneration;
          else void reconcileBrowserAccount();
        })
        .catch((error: unknown) => {
          if (isCurrent(captured) && error instanceof AuthStorageUnavailableError) {
            state.value = { kind: 'signed-out', reason: 'sign-out-incomplete' };
          }
        });
    } catch {
      /* SDK failures never retain private UI. */
    }
  }

  function signOut(): void {
    endSession('explicit');
  }

  function scheduleRenewal(delay?: number): void {
    clearTimeout(renewalTimer);
    if (
      disposed ||
      !credentials ||
      dependencies.foreground?.() === false ||
      state.value.kind !== 'ready'
    )
      return;
    const remaining = credentials.expiresAt.getTime() - clock.now() - SESSION_EXPIRY_SKEW_MS;
    renewalTimer = setTimeout(
      () => {
        renewalTimer = undefined;
        if (dependencies.foreground?.() === false) return;
        void ensureUsableCredentials().catch(() => {
          /* Persistent safe feedback is in backgroundFailure. */
        });
      },
      Math.min(
        MAX_BROWSER_TIMER_DELAY_MS,
        delay ?? Math.max(remaining, SESSION_RENEWAL_BACKOFF_MS),
      ),
    );
  }

  async function ensureUsableCredentials(forceRenewal = false): Promise<string> {
    if (disposed) throw new SessionOperationCancelledError();
    if (state.value.kind === 'uninitialized') await initialize();
    if (!browserIdentityMatches()) {
      await reconcileBrowserAccount();
      throw new SessionOperationCancelledError();
    }
    if (!credentials) throw new SessionCredentialsUnavailableError('session-ended');
    if (!forceRenewal && credentials.expiresAt.getTime() - clock.now() > SESSION_EXPIRY_SKEW_MS)
      return credentials.idToken;
    if (pendingRenewal) return pendingRenewal;
    const captured = generation;
    const startedAt = clock.now();
    const operation = (async () => {
      try {
        const result = await (dependencies.provider.renew?.(forceRenewal) ??
          dependencies.provider.restore());
        if (!isCurrent(captured)) throw new SessionOperationCancelledError();
        if (
          (result.browserGeneration &&
            observedBrowserGeneration &&
            result.browserGeneration !== observedBrowserGeneration) ||
          !browserIdentityMatches()
        ) {
          await reconcileBrowserAccount();
          throw new SessionOperationCancelledError();
        }
        if (result.kind === 'signed-out') {
          endSession('ended');
          throw new SessionCredentialsUnavailableError('session-ended');
        }
        if (result.kind === 'error') throw new SessionCredentialsUnavailableError(result.failure);
        if (
          !Number.isFinite(result.credentials.expiresAt.getTime()) ||
          result.credentials.expiresAt.getTime() <= clock.now()
        ) {
          endSession('ended');
          throw new SessionCredentialsUnavailableError('session-ended');
        }
        credentials = result.credentials;
        backgroundFailure.value = null;
        automaticRetries = 0;
        scheduleRenewal();
        return credentials.idToken;
      } catch (error) {
        if (!isCurrent(captured)) {
          if (
            error instanceof SessionCredentialsUnavailableError &&
            error.failure === 'session-ended'
          )
            throw error;
          throw new SessionOperationCancelledError();
        }
        const failure =
          error instanceof SessionCredentialsUnavailableError
            ? error.failure
            : 'provider-unavailable';
        backgroundFailure.value = failure;
        if (automaticRetries < SESSION_MAX_AUTOMATIC_RETRIES) {
          automaticRetries += 1;
          scheduleRenewal(SESSION_RENEWAL_BACKOFF_MS);
        }
        throw new SessionCredentialsUnavailableError(failure);
      }
    })();
    const tracked = operation.finally(() => {
      recordDiagnostic(SessionDiagnosticOperation.renewal, diagnosticOutcome(captured), startedAt);
      if (pendingRenewal === tracked) pendingRenewal = null;
    });
    pendingRenewal = tracked;
    return tracked;
  }

  async function reconcile(): Promise<void> {
    await reconcileBrowserAccount();
    if (disposed || dependencies.foreground?.() === false || state.value.kind !== 'ready') return;
    await ensureUsableCredentials();
    scheduleRenewal();
    await refreshContext();
    scheduleContextRefresh();
  }

  function scheduleContextRefresh(delay?: number): void {
    clearTimeout(contextTimer);
    if (disposed || dependencies.foreground?.() === false || state.value.kind !== 'ready') return;
    const remaining = SESSION_CONTEXT_FRESHNESS_MS - (clock.now() - state.value.resolvedAt);
    contextTimer = setTimeout(
      () => {
        contextTimer = undefined;
        if (dependencies.foreground?.() === false) return;
        // A provider outage gets one automatic renewal retry, not an unbounded
        // retry loop driven indirectly by the context freshness timer.
        if (backgroundFailure.value === 'provider-unavailable') {
          scheduleContextRefresh(SESSION_CONTEXT_FRESHNESS_MS);
          return;
        }
        void refreshContext(true);
      },
      delay ?? Math.max(remaining, SESSION_RENEWAL_BACKOFF_MS),
    );
  }

  function refreshContext(force = false): Promise<void> {
    if (disposed) return Promise.resolve();
    if (pendingContextRefresh) return pendingContextRefresh;
    const wasPending =
      state.value.kind === 'recoverable-error' && state.value.failure === 'pending-activation';
    if (state.value.kind !== 'ready' && !wasPending) return initialize();
    if (
      state.value.kind === 'ready' &&
      !force &&
      clock.now() - state.value.resolvedAt < SESSION_CONTEXT_FRESHNESS_MS
    )
      return Promise.resolve();
    const previous = state.value.kind === 'ready' ? state.value.context : undefined;
    const captured = generation;
    const startedAt = clock.now();
    const capturedContextVersion = contextVersion;
    const operation = (async () => {
      try {
        await ensureUsableCredentials();
        if (!isCurrent(captured) || !credentials) return;
        const result = await dependencies.readContext(credentials, abortController.signal);
        if (!isCurrent(captured) || capturedContextVersion !== contextVersion) return;
        if (!browserIdentityMatches()) {
          void reconcileBrowserAccount();
          return;
        }
        if (result.kind === 'error') {
          if (result.failure === 'credentials-stale' || result.failure === 'session-ended') {
            endSession(result.failure === 'credentials-stale' ? 'credentials-stale' : 'ended');
            return;
          }
          if (
            result.failure === 'pending-activation' ||
            result.failure === 'inactive' ||
            result.failure === 'inconsistent'
          ) {
            if (!wasPending || result.failure !== 'pending-activation') {
              identityVersion.value += 1;
              clearPrivateState();
            }
            state.value = { kind: 'recoverable-error', failure: result.failure };
            return;
          }
          backgroundFailure.value = result.failure;
          return;
        }
        const next = result.context;
        if (previous && previous.kind !== 'unattached' && next.kind === 'unattached') {
          endSession('ended');
          return;
        }
        if (
          previous &&
          previous.kind !== 'unattached' &&
          next.kind !== 'unattached' &&
          (previous.membership.memberId !== next.membership.memberId ||
            previous.membership.household.householdId !== next.membership.household.householdId ||
            previous.membership.role !== next.membership.role ||
            (previous.kind === 'active' && next.kind === 'profile-required'))
        ) {
          identityVersion.value += 1;
          clearPrivateState();
        }
        state.value = { kind: 'ready', context: next, resolvedAt: clock.now() };
        backgroundFailure.value = null;
      } catch (error) {
        if (isCurrent(captured))
          backgroundFailure.value =
            error instanceof SessionCredentialsUnavailableError
              ? error.failure
              : 'context-unavailable';
      } finally {
        if (isCurrent(captured)) scheduleContextRefresh(SESSION_CONTEXT_FRESHNESS_MS);
      }
    })();
    const tracked = operation.finally(() => {
      recordDiagnostic(
        SessionDiagnosticOperation.contextRefresh,
        diagnosticOutcome(captured),
        startedAt,
      );
      if (pendingContextRefresh === tracked) pendingContextRefresh = null;
    });
    pendingContextRefresh = tracked;
    return tracked;
  }

  function requestContext(observeAccess = true): AuthenticatedRequestSession {
    const captured = generation;
    return {
      credentials: ensureUsableCredentials,
      isCurrent: () => {
        if (!isCurrent(captured)) return false;
        if (!browserIdentityMatches()) {
          void reconcileBrowserAccount();
          return false;
        }
        return true;
      },
      signal: abortController.signal,
      ...(observeAccess
        ? {
            onResponse: async ({
              status,
              code,
            }: {
              status: number;
              code: unknown;
              url: string;
            }) => {
              if (!isCurrent(captured)) return;
              if (status === 401) {
                endSession(
                  code === CurrentMembershipApi.credentialsStale ? 'credentials-stale' : 'ended',
                );
                return;
              }
              if (status === 403 && code === SessionApiFailureCode.accessUnavailable)
                await refreshContext(true);
            },
          }
        : {}),
    };
  }

  function dispose(): void {
    invalidate();
    disposed = true;
    state.value = { kind: 'signed-out', reason: 'missing' };
    clearPrivateState();
  }

  function requireIdToken(): string {
    if (!credentials || credentials.expiresAt.getTime() <= clock.now())
      throw new AuthSessionUnavailableError();
    return credentials.idToken;
  }

  function applyConfirmedMembership(membership: CurrentMembership | null): void {
    if (state.value.kind !== 'ready') return;
    contextVersion += 1;
    const context: SessionContext = membership
      ? { kind: 'profile-required', membership }
      : { kind: 'unattached' };
    state.value = { kind: 'ready', context, resolvedAt: clock.now() };
    scheduleContextRefresh();
  }

  function applyConfirmedProfile(profile: Profile | null): void {
    if (state.value.kind !== 'ready' || state.value.context.kind === 'unattached') return;
    const membership = state.value.context.membership;
    contextVersion += 1;
    const context: SessionContext = profile
      ? { kind: 'active', membership, profile }
      : { kind: 'profile-required', membership };
    state.value = { kind: 'ready', context, resolvedAt: state.value.resolvedAt };
  }

  async function verifyEmailAttribute(
    code?: string,
  ): Promise<AuthActionResult | { kind: 'cancelled' }> {
    const captured = generation;
    await ensureUsableCredentials();
    if (!isCurrent(captured) || !credentials || !dependencies.account?.verifyEmailAttribute)
      return { kind: 'cancelled' };
    const result = await dependencies.account.verifyEmailAttribute(credentials.accessToken, code);
    if (!isCurrent(captured) || !browserIdentityMatches()) return { kind: 'cancelled' };
    if (result.kind === 'success' && code !== undefined) await ensureUsableCredentials(true);
    if (!isCurrent(captured) || !browserIdentityMatches()) return { kind: 'cancelled' };
    return result;
  }
  return {
    verifyEmailAttribute,
    state: readonly(state),
    backgroundFailure: readonly(backgroundFailure),
    identityVersion: readonly(identityVersion),
    account: dependencies.account,
    initialize,
    signIn,
    signOut,
    dispose,
    requireIdToken,
    ensureUsableCredentials,
    reconcile,
    reconcileBrowserAccount,
    refreshContext,
    requestContext,
    applyConfirmedMembership,
    applyConfirmedProfile,
  };
}

export type SessionController = ReturnType<typeof createSessionController>;
