import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionController,
  type SessionProviderResult,
} from '../../session/sessionController';
import { SESSION_EXPIRY_SKEW_MS, SESSION_RENEWAL_BACKOFF_MS } from '../../session/timing';
import {
  SessionCredentialsUnavailableError,
  SessionOperationCancelledError,
} from '../../session/sessionErrors';

function fixture() {
  const credentials = {
    idToken: 'old-id',
    accessToken: 'old-access',
    expiresAt: new Date(Date.now() + 300_000),
  };
  const provider = {
    restore: vi.fn(async (): Promise<SessionProviderResult> => ({ kind: 'usable', credentials })),
    renew: vi.fn(async (): Promise<SessionProviderResult> => ({
      kind: 'usable',
      credentials: {
        ...credentials,
        idToken: 'renewed-id',
        expiresAt: new Date(Date.now() + 300_000),
      },
    })),
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
  const readContext = vi.fn(async () => ({
    kind: 'success' as const,
    context: { kind: 'unattached' as const },
  }));
  let foreground = true;
  const session = createSessionController({ provider, readContext, foreground: () => foreground });
  return {
    session,
    provider,
    readContext,
    credentials,
    hide: () => {
      foreground = false;
    },
    show: () => {
      foreground = true;
    },
  };
}

describe('silent controller renewal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it('reuses usable credentials without provider calls', async () => {
    const { session, provider } = fixture();
    await session.initialize();
    expect(await session.ensureUsableCredentials()).toBe('old-id');
    expect(provider.renew).not.toHaveBeenCalled();
    session.dispose();
  });
  it('renews once at the named skew while preserving ready context', async () => {
    const { session, provider, readContext } = fixture();
    await session.initialize();
    const previousState = session.state.value;
    await vi.advanceTimersByTimeAsync(300_000 - SESSION_EXPIRY_SKEW_MS);
    expect(provider.renew).toHaveBeenCalledOnce();
    expect(await session.ensureUsableCredentials()).toBe('renewed-id');
    expect(session.state.value).toBe(previousState);
    expect(readContext).toHaveBeenCalledOnce();
    session.dispose();
  });
  it('coalesces concurrent expired-credential callers after sleep', async () => {
    const { session, provider } = fixture();
    await session.initialize();
    vi.setSystemTime(Date.now() + 600_000);
    let finish!: (result: SessionProviderResult) => void;
    provider.renew.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const reads = [
      session.ensureUsableCredentials(),
      session.ensureUsableCredentials(),
      session.reconcile(),
    ];
    expect(provider.renew).toHaveBeenCalledOnce();
    finish({
      kind: 'usable',
      credentials: {
        idToken: 'fresh-id',
        accessToken: 'fresh-access',
        expiresAt: new Date(Date.now() + 300_000),
      },
    });
    expect(await Promise.all(reads)).toEqual(['fresh-id', 'fresh-id', undefined]);
    session.dispose();
  });
  it('keeps permitted context on a transient failure and bounds automatic retries', async () => {
    const { session, provider } = fixture();
    await session.initialize();
    provider.renew.mockResolvedValue({ kind: 'error', failure: 'provider-unavailable' });
    await vi.advanceTimersByTimeAsync(240_000);
    expect(session.state.value.kind).toBe('ready');
    expect(session.backgroundFailure.value).toBe('provider-unavailable');
    await vi.advanceTimersByTimeAsync(SESSION_RENEWAL_BACKOFF_MS * 10);
    expect(provider.renew).toHaveBeenCalledTimes(2);
    await expect(session.ensureUsableCredentials()).rejects.toBeInstanceOf(
      SessionCredentialsUnavailableError,
    );
    session.dispose();
  });
  it('clears private context on terminal invalidity', async () => {
    const { session, provider } = fixture();
    await session.initialize();
    provider.renew.mockResolvedValue({ kind: 'signed-out', reason: 'ended' });
    await expect(session.ensureUsableCredentials(true)).rejects.toBeInstanceOf(
      SessionCredentialsUnavailableError,
    );
    expect(session.state.value).toEqual({ kind: 'signed-out', reason: 'ended' });
    expect(provider.signOut).toHaveBeenCalledOnce();
    session.dispose();
  });
  it('discards renewal completion after sign-out', async () => {
    const { session, provider, credentials } = fixture();
    await session.initialize();
    let finish!: (result: SessionProviderResult) => void;
    provider.renew.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const renewal = session.ensureUsableCredentials(true);
    const rejected = expect(renewal).rejects.toBeInstanceOf(SessionOperationCancelledError);
    session.signOut();
    finish({ kind: 'usable', credentials });
    await rejected;
    expect(session.state.value.kind).toBe('signed-out');
    session.dispose();
  });
  it('skips hidden timers and reconciles time before foreground use', async () => {
    const { session, provider, hide, show } = fixture();
    await session.initialize();
    hide();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(provider.renew).not.toHaveBeenCalled();
    show();
    await session.reconcile();
    expect(provider.renew).toHaveBeenCalledOnce();
    session.dispose();
  });
});
