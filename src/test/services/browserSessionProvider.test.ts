import { describe, expect, it, vi } from 'vitest';
import {
  createAuthStorage,
  createMemoryAuthStorage,
  type AuthStorageDependencies,
} from '../../session/authStorage';
import { createBrowserSessionProvider } from '../../session/browserSessionProvider';
import { createSessionController } from '../../session/sessionController';
import { localCredentialKey } from '../../session/authStorageContract';
import { AuthSessionEndedError } from '../../services/authSessionErrors';
import { SessionOperationCancelledError } from '../../session/sessionErrors';
import type { AuthClient, AuthSession } from '../../services/authClient';

const config = {
  userPoolId: 'local_pool',
  clientId: 'client',
  registrationClientId: 'registration',
  region: 'local',
  localEndpoint: 'http://localhost:9229',
};
function fixture() {
  const shared = createMemoryAuthStorage();
  let sequence = 0;
  let queue = Promise.resolve();
  const exclusive: AuthStorageDependencies['exclusive'] = (work) => {
    const operation = queue.then(work);
    queue = operation.then(
      () => {},
      () => {},
    );
    return operation;
  };
  const store = () =>
    createAuthStorage('client', {
      shared: () => shared,
      legacy: createMemoryAuthStorage,
      exclusive,
      nonce: () => `generation-${++sequence}`,
    });
  const hooks = {
    signingIn: vi.fn(async () => {}),
    renewing: vi.fn(async () => {}),
    cleanup: vi.fn(() => {}),
  };
  const makeClient = (storage: Storage) =>
    ({
      async signIn(username: string) {
        await hooks.signingIn();
        const session = {
          idToken: `synthetic-token-${username}`,
          accessToken: 'synthetic-access',
          expiresAt: new Date('2030-01-01'),
        };
        storage.setItem(localCredentialKey('client'), JSON.stringify(session));
        return { kind: 'success', session };
      },
      async restoreSession() {
        const raw = storage.getItem(localCredentialKey('client'));
        if (!raw) return null;
        const value = JSON.parse(raw);
        return { ...value, expiresAt: new Date(value.expiresAt) } as AuthSession;
      },
      async renewSession() {
        await hooks.renewing();
        const raw = storage.getItem(localCredentialKey('client'));
        const value = raw ? JSON.parse(raw) : null;
        const session = {
          idToken: value?.idToken ?? 'late-old-token',
          accessToken: 'renewed-access',
          expiresAt: new Date('2030-01-01'),
        };
        storage.setItem(localCredentialKey('client'), JSON.stringify(session));
        return session;
      },
      signOut() {
        storage.removeItem(localCredentialKey('client'));
        hooks.cleanup();
      },
    }) as unknown as AuthClient;
  const storage = store();
  const runtime = createBrowserSessionProvider(config, storage, makeClient);
  const clearPrivateState = vi.fn();
  const controller = createSessionController({
    provider: runtime.provider,
    readBrowserGeneration: () => storage.readMarker()?.generation ?? null,
    clearPrivateState,
    readContext: async (credentials) => ({
      kind: 'success',
      context: {
        kind: 'active',
        membership: {
          memberId: credentials.idToken.endsWith('account-b') ? 'b' : 'a',
          username: 'synthetic-user',
          role: 'parent',
          household: { householdId: 'house', name: 'Home', timezone: 'America/Chicago' },
        },
        profile: { memberId: 'member', displayName: 'Synthetic', color: 'PINE', version: 1 },
      },
    }),
  });
  return { shared, storage, runtime, controller, hooks, makeClient, store, clearPrivateState };
}
describe('provider/storage interleavings', () => {
  it('rejects an SDK sign-in completing after a peer publishes sign-out', async () => {
    const { runtime, store, hooks, shared, controller } = fixture();
    let finish!: () => void;
    hooks.signingIn.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = runtime.provider.signIn('account-a', 'synthetic-password');
    await vi.waitFor(() => expect(hooks.signingIn).toHaveBeenCalledOnce());
    await store().signOut();
    finish();
    expect(await pending).toEqual({ kind: 'cancelled' });
    expect((await store().restoreBinding()).binding).toBeNull();
    expect(shared.length).toBe(1);
    controller.dispose();
  });
  it('clears memory/storage despite SDK cleanup throwing while renewal is pending', async () => {
    const { runtime, storage, controller, hooks, shared, clearPrivateState } = fixture();
    await runtime.provider.signIn('account-a', 'synthetic-password');
    await controller.initialize();
    let finish!: () => void;
    hooks.renewing.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    hooks.cleanup.mockImplementation(() => {
      throw new Error('private-sdk-diagnostic');
    });
    const renewal = controller.ensureUsableCredentials(true);
    const rejected = expect(renewal).rejects.toBeInstanceOf(SessionOperationCancelledError);
    await vi.waitFor(() => expect(hooks.renewing).toHaveBeenCalledOnce());
    controller.signOut();
    expect(controller.state.value.kind).toBe('signed-out');
    expect(clearPrivateState).toHaveBeenCalledOnce();
    await storage.initialize();
    finish();
    await rejected;
    expect((await storage.restoreBinding()).binding).toBeNull();
    expect(shared.length).toBe(1);
    controller.dispose();
  });
  it('does not let an old terminal SDK result sign out a peer’s newer account', async () => {
    const { runtime, storage, controller, hooks, makeClient, store } = fixture();
    await runtime.provider.signIn('account-a', 'synthetic-password');
    await controller.initialize();
    let reject!: (error: Error) => void;
    hooks.renewing.mockReturnValue(
      new Promise((_, failure) => {
        reject = failure;
      }),
    );
    const renewal = controller.ensureUsableCredentials(true);
    const rejected = expect(renewal).rejects.toBeInstanceOf(SessionOperationCancelledError);
    await vi.waitFor(() => expect(hooks.renewing).toHaveBeenCalledOnce());
    const peer = createBrowserSessionProvider(config, store(), makeClient);
    await peer.provider.signIn('account-b', 'synthetic-password');
    const next = storage.readMarker();
    reject(new AuthSessionEndedError());
    await rejected;
    expect(storage.readMarker()).toEqual(next);
    expect(controller.state.value).toMatchObject({
      kind: 'ready',
      context: { membership: { memberId: 'b' } },
    });
    expect(JSON.stringify(controller.state.value)).not.toContain('synthetic-token');
    controller.dispose();
  });
});
