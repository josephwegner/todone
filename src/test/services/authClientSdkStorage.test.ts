import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CognitoAccessToken,
  CognitoIdToken,
  CognitoRefreshToken,
  CognitoUser,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { AuthClient } from '../../services/authClient';
import { createAuthStorage, createMemoryAuthStorage } from '../../session/authStorage';
import { createBrowserSessionProvider } from '../../session/browserSessionProvider';
import { authStoragePrefix, sdkAuthPrefix } from '../../session/authStorageContract';

const config = {
  userPoolId: 'us-east-1_SyntheticPool',
  clientId: 'sdk-test-client',
  registrationClientId: 'sdk-registration-client',
  region: 'us-east-1',
};
function sdkSession() {
  const now = Math.floor(Date.now() / 1000);
  const jwt = `header.${btoa(JSON.stringify({ iat: now, exp: now + 3600 }))}.synthetic`;
  return new CognitoUserSession({
    IdToken: new CognitoIdToken({ IdToken: jwt }),
    AccessToken: new CognitoAccessToken({ AccessToken: jwt }),
    RefreshToken: new CognitoRefreshToken({ RefreshToken: 'sdk-refresh-canary' }),
  });
}
function storageFixture() {
  let generation = 0;
  return createAuthStorage(config.clientId, {
    shared: () => localStorage,
    legacy: () => sessionStorage,
    exclusive: async (work) => work(),
    nonce: () => `sdk-generation-${++generation}`,
  });
}
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('production Cognito SDK storage boundary', () => {
  it('publishes actual SDK token caching, restores a fresh provider, and clears only scoped credentials', async () => {
    // Only authentication transport is replaced. Real constructors, session token
    // caching, getCurrentUser/getSession, and SDK sign-out retain their implementation.
    const signedInSession = sdkSession();
    vi.spyOn(CognitoUser.prototype, 'authenticateUser').mockImplementation(
      function (details, callbacks) {
        expect(details.getUsername()).toBe('SyntheticParent');
        this.setSignInUserSession(signedInSession);
        callbacks.onSuccess(signedInSession);
      },
    );
    localStorage.setItem('unrelated-sdk-test', 'keep');
    const storage = storageFixture();
    const runtime = createBrowserSessionProvider(config, storage);
    const result = await runtime.provider.signIn('SyntheticParent', 'SyntheticPassword123!');
    expect(result.kind).toBe('success');
    expect(storage.readMarker()?.kind).toBe('signed-in');
    expect(
      Object.keys(localStorage).filter((key) => key.startsWith(sdkAuthPrefix(config.clientId))),
    ).toEqual([]);
    expect(
      Object.keys(localStorage).some((key) =>
        key.startsWith(`${authStoragePrefix(config.clientId)}credentials.`),
      ),
    ).toBe(true);
    const peer = createBrowserSessionProvider(config, storage);
    const restored = await peer.provider.restore();
    expect(restored).toMatchObject({
      kind: 'usable',
      credentials: { idToken: signedInSession.getIdToken().getJwtToken() },
    });
    expect(Object.values(localStorage)).toContain('sdk-refresh-canary');
    await peer.provider.signOut('explicit');
    expect(await runtime.provider.restore()).toMatchObject({ kind: 'signed-out' });
    expect(Object.keys(localStorage).sort()).toEqual(
      ['unrelated-sdk-test', storage.markerKey].sort(),
    );
    expect(localStorage.getItem('unrelated-sdk-test')).toBe('keep');
    expect(Object.values(localStorage)).not.toContain('sdk-refresh-canary');
  });

  it('cannot cache unscoped tokens or publish a real SDK sign-in that completes after logout', async () => {
    let complete!: () => void;
    vi.spyOn(CognitoUser.prototype, 'authenticateUser').mockImplementation(
      function (_details, callbacks) {
        complete = () => {
          const credentials = sdkSession();
          this.setSignInUserSession(credentials);
          callbacks.onSuccess(credentials);
        };
      },
    );
    const storage = storageFixture();
    const runtime = createBrowserSessionProvider(config, storage);
    const signingIn = runtime.provider.signIn('SyntheticParent', 'SyntheticPassword123!');
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    await storage.signOut();
    complete();
    expect(await signingIn).toEqual({ kind: 'cancelled' });
    expect(Object.keys(localStorage)).toEqual([storage.markerKey]);
    expect(Object.values(localStorage)).not.toContain('sdk-refresh-canary');
  });

  it('keeps explicitly constructed recovery and registration users in their injected memory scope', async () => {
    const scope = createMemoryAuthStorage();
    vi.spyOn(CognitoUser.prototype, 'forgotPassword').mockImplementation(function (callbacks) {
      expect(Reflect.get(this, 'storage')).toBe(scope);
      callbacks.onSuccess({});
    });
    vi.spyOn(CognitoUser.prototype, 'confirmRegistration').mockImplementation(
      function (_code, _force, callback) {
        expect(Reflect.get(this, 'storage')).toBe(scope);
        callback(null, 'SUCCESS');
      },
    );
    const account = new AuthClient(config, scope);
    expect(await account.forgotPassword('SyntheticParent')).toEqual({ kind: 'success' });
    expect(await account.confirmRegistration('SyntheticParent', '123456')).toEqual({
      kind: 'success',
    });
    expect(localStorage.length).toBe(0);
  });
});
