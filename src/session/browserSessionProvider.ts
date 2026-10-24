import type { AuthConfig } from '../config/authConfig';
import { AuthClient } from '../services/authClient';
import { AuthSessionEndedError, AuthStorageUnavailableError } from '../services/authSessionErrors';
import type { SessionProvider, SessionProviderResult } from './sessionController';
import { createAuthStorage, createMemoryAuthStorage, type AuthStorage } from './authStorage';
import { withProviderTimeout } from './authSessionProvider';
import { SESSION_EXPIRY_SKEW_MS } from './timing';

/** Each SDK client is bound to one storage generation, never retargeted in flight. */
export function createBrowserSessionProvider(
  config: AuthConfig,
  storage: AuthStorage = createAuthStorage(config.clientId),
  makeClient: (scope: Storage) => AuthClient = (scope) => new AuthClient(config, scope),
) {
  const accountStorage = createMemoryAuthStorage();
  const account = makeClient(accountStorage);
  let activeClient: AuthClient | null = null;
  let lastGeneration: string | undefined;
  let lastIdToken: string | null = null;
  async function acquire(renew: boolean, force = false): Promise<SessionProviderResult> {
    let browserGeneration: string | undefined;
    try {
      const restored = await storage.restoreBinding();
      browserGeneration = restored.marker.generation;
      if (!restored.binding) {
        lastGeneration = browserGeneration;
        lastIdToken = null;
        return {
          kind: 'signed-out',
          browserGeneration,
          ...(restored.migratedLegacy ? { reason: 'upgrade' as const } : {}),
        };
      }
      const client = makeClient(restored.binding.storage);
      let credentials = await withProviderTimeout(client.restoreSession());
      if (!credentials) return { kind: 'signed-out', reason: 'ended', browserGeneration };
      if (
        renew &&
        (credentials.expiresAt.getTime() - Date.now() <= SESSION_EXPIRY_SKEW_MS ||
          (force && credentials.idToken === lastIdToken))
      )
        credentials = await withProviderTimeout(client.renewSession());
      if (!credentials) return { kind: 'signed-out', reason: 'ended', browserGeneration };
      if (storage.readMarker()?.generation === browserGeneration) {
        activeClient = client;
        lastGeneration = browserGeneration;
        lastIdToken = credentials.idToken;
      }
      return { kind: 'usable', credentials, browserGeneration };
    } catch (error) {
      if (error instanceof AuthSessionEndedError)
        return { kind: 'signed-out', reason: 'ended', browserGeneration };
      return {
        kind: 'error',
        browserGeneration,
        failure:
          error instanceof AuthStorageUnavailableError
            ? 'storage-unavailable'
            : 'provider-unavailable',
      };
    }
  }
  const provider: SessionProvider = {
    restore: () => acquire(false),
    renew: (force) => acquire(true, force),
    async signIn(username, password, newPassword) {
      const stage = await storage.beginSignIn();
      const client = makeClient(stage.storage);
      try {
        const result = await withProviderTimeout(client.signIn(username, password, newPassword));
        if (result.kind === 'error') return result;
        const marker = await storage.publish(stage);
        if (!marker) return { kind: 'cancelled' };
        activeClient = client;
        lastGeneration = marker.generation;
        lastIdToken = result.session.idToken;
        return { ...result, browserGeneration: marker.generation };
      } finally {
        stage.storage.clear();
        stage.close();
      }
    },
    async signOut(reason, expectedGeneration) {
      const client = activeClient;
      activeClient = null;
      lastIdToken = null;
      const marker = await storage.signOut(
        reason === 'explicit' ? undefined : (expectedGeneration ?? lastGeneration),
      );
      lastGeneration = marker.generation;
      accountStorage.clear();
      try {
        client?.signOut();
      } catch {
        /* The durable marker and scoped cleanup already revoked publication. */
      }
      return { browserGeneration: marker.generation, signedOut: marker.kind === 'signed-out' };
    },
  };
  return { provider, account, storage };
}
