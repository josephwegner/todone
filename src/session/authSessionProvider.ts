import type { AuthClient } from '../services/authClient';
import {
  AuthProviderUnavailableError,
  AuthSessionEndedError,
  AuthStorageUnavailableError,
} from '../services/authSessionErrors';
import type { SessionProvider, SessionProviderResult } from './sessionController';
import { SESSION_PROVIDER_TIMEOUT_MS } from './timing';

/** Bound SDK operations; late provider completion still needs generation-bound storage. */
export async function withProviderTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AuthProviderUnavailableError()),
          SESSION_PROVIDER_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createAuthSessionProvider(client: AuthClient): SessionProvider {
  async function acquire(renew: boolean): Promise<SessionProviderResult> {
    try {
      const credentials = await withProviderTimeout(
        renew ? client.renewSession() : client.restoreSession(),
      );
      if (!credentials) return { kind: 'signed-out' };
      return { kind: 'usable', credentials };
    } catch (error) {
      if (error instanceof AuthSessionEndedError) return { kind: 'signed-out', reason: 'ended' };
      if (error instanceof AuthStorageUnavailableError)
        return { kind: 'error', failure: 'storage-unavailable' };
      return { kind: 'error', failure: 'provider-unavailable' };
    }
  }
  return {
    restore: () => acquire(false),
    renew: () => acquire(true),
    signIn: (username, password) => withProviderTimeout(client.signIn(username, password)),
    signOut: () => client.signOut(),
  };
}
