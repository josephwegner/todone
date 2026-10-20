import { describe, expect, it, vi } from 'vitest';
import { isReadonly } from 'vue';
import {
  createSessionController,
  type SessionContextResult,
  type SessionProviderResult,
} from '../../session/sessionController';
import type { AuthSession } from '../../services/authClient';

const credentials: AuthSession = {
  idToken: 'private-id-canary',
  accessToken: 'private-access-canary',
  expiresAt: new Date('2030-01-01'),
};
const membership = {
  memberId: 'member',
  username: 'parent',
  role: 'parent' as const,
  household: { householdId: 'house', name: 'House', timezone: 'America/Chicago' },
};
const profile = { memberId: 'member', displayName: 'River', color: 'PINE' as const, version: 1 };
const active = { kind: 'active' as const, membership, profile };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fixture() {
  const provider = {
    restore: vi.fn(async (): Promise<SessionProviderResult> => ({ kind: 'usable', credentials })),
    signIn: vi.fn(async () => ({ kind: 'success' as const, session: credentials })),
    signOut: vi.fn(),
  };
  const context = vi.fn(async (): Promise<SessionContextResult> => ({
    kind: 'success',
    context: active,
  }));
  const clearPrivateState = vi.fn();
  const controller = createSessionController({
    provider,
    readContext: context,
    clock: { now: () => 1234 },
    clearPrivateState,
  });
  return { controller, provider, context, clearPrivateState };
}

describe('app session controller initialization', () => {
  it('shares startup across simultaneous consumers and later ready navigation', async () => {
    const { controller, provider, context } = fixture();
    const restoration = deferred<SessionProviderResult>();
    provider.restore.mockReturnValue(restoration.promise);
    const first = controller.initialize();
    const second = controller.initialize();
    expect(controller.state.value.kind).toBe('initializing');
    expect(provider.restore).toHaveBeenCalledOnce();
    restoration.resolve({ kind: 'usable', credentials });
    await Promise.all([first, second]);
    await controller.initialize();
    expect(context).toHaveBeenCalledOnce();
    expect(provider.restore).toHaveBeenCalledOnce();
    expect(controller.state.value).toEqual({ kind: 'ready', context: active, resolvedAt: 1234 });
    expect(isReadonly(controller.state)).toBe(true);
    expect(isReadonly(controller.state.value)).toBe(true);
    expect(JSON.stringify(controller.state.value)).not.toContain('private-');
  });

  it.each([
    { kind: 'unattached' as const },
    { kind: 'profile-required' as const, membership },
    active,
  ])('preserves the %s onboarding context', async (value) => {
    const { controller, context } = fixture();
    context.mockResolvedValue({ kind: 'success', context: value });
    await controller.initialize();
    expect(controller.state.value).toMatchObject({ kind: 'ready', context: value });
  });

  it.each(['pending-activation', 'inactive', 'inconsistent', 'credentials-stale'] as const)(
    'preserves %s as a denial rather than household setup',
    async (failure) => {
      const { controller, context } = fixture();
      context.mockResolvedValue({ kind: 'error', failure });
      await controller.initialize();
      if (failure === 'credentials-stale')
        expect(controller.state.value).toMatchObject({
          kind: 'signed-out',
          reason: 'credentials-stale',
        });
      else expect(controller.state.value).toMatchObject({ kind: 'recoverable-error', failure });
      expect(controller.state.value).not.toHaveProperty('context');
    },
  );

  it('does not publish identity when sign-out interrupts restoration', async () => {
    const { controller, provider, context } = fixture();
    const restoration = deferred<SessionProviderResult>();
    provider.restore.mockReturnValue(restoration.promise);
    const initialization = controller.initialize();
    controller.signOut();
    restoration.resolve({ kind: 'usable', credentials });
    await initialization;
    expect(context).not.toHaveBeenCalled();
    expect(controller.state.value).toMatchObject({ kind: 'signed-out' });
  });

  it('aborts context reads and discards late success despite SDK cleanup failure', async () => {
    const { controller, provider, context, clearPrivateState } = fixture();
    const read = deferred<SessionContextResult>();
    context.mockReturnValue(read.promise);
    provider.signOut.mockImplementation(() => {
      throw new Error('private SDK message');
    });
    const initialization = controller.initialize();
    await vi.waitFor(() => expect(context).toHaveBeenCalledOnce());
    const signal = context.mock.calls[0]?.[1] as AbortSignal;
    controller.signOut();
    expect(signal.aborted).toBe(true);
    read.resolve({ kind: 'success', context: active });
    await initialization;
    expect(controller.state.value).toEqual({ kind: 'signed-out', reason: 'explicit' });
    expect(clearPrivateState).toHaveBeenCalledOnce();
  });

  it('lets a newer sign-in replace a pending old initialization', async () => {
    const { controller, provider } = fixture();
    const restoration = deferred<SessionProviderResult>();
    provider.restore.mockReturnValue(restoration.promise);
    const initialization = controller.initialize();
    await controller.signIn('new-account', 'form-local-password');
    restoration.resolve({ kind: 'signed-out' });
    await initialization;
    expect(controller.state.value).toMatchObject({ kind: 'ready', context: active });
  });

  it('discards disposed work and never exposes raw dependency errors', async () => {
    const { controller, provider } = fixture();
    provider.restore.mockRejectedValue(new Error('private-provider-canary'));
    await controller.initialize();
    expect(controller.state.value).toEqual({
      kind: 'recoverable-error',
      failure: 'provider-unavailable',
    });
    expect(JSON.stringify(controller.state.value)).not.toContain('canary');
    controller.dispose();
    await controller.initialize();
    expect(provider.restore).toHaveBeenCalledOnce();
  });

  it('permits retry after transient failure and releases the pending operation', async () => {
    const { controller, context } = fixture();
    context.mockResolvedValueOnce({ kind: 'error', failure: 'context-unavailable' });
    await controller.initialize();
    expect(controller.state.value.kind).toBe('recoverable-error');
    await Promise.all([controller.initialize(), controller.initialize()]);
    expect(controller.state.value.kind).toBe('ready');
    expect(context).toHaveBeenCalledTimes(2);
  });
});
