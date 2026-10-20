import {
  AuthProviderUnavailableError,
  AuthSessionEndedError,
} from '../../services/authSessionErrors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateUserMock = vi.fn();
const signOutMock = vi.fn();
const getSignInUserSessionMock = vi.fn();
const getSessionMock = vi.fn();
const refreshSessionMock = vi.fn();
const getCurrentUserMock = vi.fn();
const signUpMock = vi.fn();
const confirmRegistrationMock = vi.fn();
const resendConfirmationCodeMock = vi.fn();
const forgotPasswordMock = vi.fn();
const confirmPasswordMock = vi.fn();
const poolConfigs: unknown[] = [];
const cognitoUserConfigs: unknown[] = [];

vi.mock('amazon-cognito-identity-js', () => {
  class CognitoUserPool {
    constructor(public config: unknown) {
      poolConfigs.push(config);
    }
    getCurrentUser() {
      return getCurrentUserMock();
    }
    signUp(...args: unknown[]) {
      return signUpMock(...args);
    }
  }
  class AuthenticationDetails {
    constructor(public data: unknown) {}
  }
  class CognitoUserAttribute {
    constructor(public data: unknown) {}
  }
  class CognitoUser {
    constructor(public data: unknown) {
      cognitoUserConfigs.push(data);
    }
    authenticateUser(details: unknown, callbacks: unknown) {
      authenticateUserMock(details, callbacks);
    }
    signOut() {
      signOutMock();
    }
    getSignInUserSession() {
      return getSignInUserSessionMock();
    }
    refreshSession(...args: unknown[]) {
      return refreshSessionMock(...args);
    }
    getSession(callback: unknown) {
      getSessionMock(callback);
    }
    confirmRegistration(...args: unknown[]) {
      return confirmRegistrationMock(...args);
    }
    resendConfirmationCode(...args: unknown[]) {
      return resendConfirmationCodeMock(...args);
    }
    forgotPassword(callbacks: unknown) {
      return forgotPasswordMock(callbacks);
    }
    confirmPassword(...args: unknown[]) {
      return confirmPasswordMock(...args);
    }
  }
  return { CognitoUserPool, AuthenticationDetails, CognitoUser, CognitoUserAttribute };
});

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-cognito-identity-provider', () => {
  class CognitoIdentityProviderClient {
    constructor(public config: unknown) {}
    send(command: unknown) {
      return sendMock(command);
    }
  }
  class InitiateAuthCommand {
    constructor(public input: unknown) {}
  }
  class SignUpCommand {
    constructor(public input: unknown) {}
  }
  return { CognitoIdentityProviderClient, InitiateAuthCommand, SignUpCommand };
});

const { AuthClient, AuthSessionUnavailableError } = await import('../../services/authClient');

interface MockCallbacks {
  onSuccess: (session: unknown) => void;
  onFailure: (err: unknown) => void;
}

function buildSession(
  overrides: Partial<{ idToken: string; accessToken: string; exp: number }> = {},
) {
  const idToken = overrides.idToken ?? 'id-token-value';
  const accessToken = overrides.accessToken ?? 'access-token-value';
  const exp = overrides.exp ?? Math.floor(Date.now() / 1000) + 3600;
  return {
    getIdToken: () => ({ getJwtToken: () => idToken, getExpiration: () => exp }),
    getAccessToken: () => ({ getJwtToken: () => accessToken, getExpiration: () => exp }),
    getRefreshToken: () => ({ getToken: () => 'synthetic-refresh' }),
  };
}

function buildClient() {
  return new AuthClient(
    {
      userPoolId: 'pool-id',
      clientId: 'client-id',
      registrationClientId: 'registration-client-id',
      region: 'us-east-1',
    },
    sessionStorage,
  );
}

function buildLocalClient() {
  return new AuthClient(
    {
      userPoolId: 'local_abc123',
      clientId: 'local-client-id',
      registrationClientId: 'local-registration-client-id',
      region: 'local',
      localEndpoint: 'http://localhost:9229',
    },
    sessionStorage,
  );
}

describe('AuthClient', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    authenticateUserMock.mockReset();
    signOutMock.mockReset();
    getSignInUserSessionMock.mockReset();
    getSessionMock.mockReset();
    refreshSessionMock.mockReset();
    getCurrentUserMock.mockReset();
    signUpMock.mockReset();
    confirmRegistrationMock.mockReset();
    resendConfirmationCodeMock.mockReset();
    forgotPasswordMock.mockReset();
    confirmPasswordMock.mockReset();
    sendMock.mockReset();
    poolConfigs.length = 0;
    cognitoUserConfigs.length = 0;
  });

  it('uses the injected SDK storage without choosing a persistence policy', () => {
    buildClient();

    expect(poolConfigs).toHaveLength(2);
    expect(poolConfigs[0]).toEqual(expect.objectContaining({ Storage: sessionStorage }));
    expect(poolConfigs[1]).toEqual(
      expect.objectContaining({ ClientId: 'registration-client-id', Storage: sessionStorage }),
    );
    expect(localStorage).toHaveLength(0);
  });

  it('returns a success result with idToken, accessToken, and expiresAt', async () => {
    const session = buildSession();
    authenticateUserMock.mockImplementation((_details, callbacks: MockCallbacks) => {
      callbacks.onSuccess(session);
    });

    const result = await buildClient().signIn('parent1', 'correct-password');

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.session.idToken).toBe('id-token-value');
      expect(result.session.accessToken).toBe('access-token-value');
      expect(result.session.expiresAt).toBeInstanceOf(Date);
    }
  });

  it('registers an unattached parent with email and temporary gate validation data', async () => {
    signUpMock.mockImplementation((_username, _password, _attributes, _validationData, callback) =>
      callback(null, {}),
    );
    const result = await buildClient().registerFirstParent(
      'ParentOne',
      'StrongPassword123!',
      'parent@example.invalid',
      'gate-secret',
    );
    expect(result).toEqual({ kind: 'success' });
    expect(signUpMock).toHaveBeenCalledWith(
      'parentone',
      'StrongPassword123!',
      [expect.objectContaining({ data: { Name: 'email', Value: 'parent@example.invalid' } })],
      [
        expect.objectContaining({
          data: { Name: 'registrationGatePassword', Value: 'gate-secret' },
        }),
      ],
      expect.any(Function),
    );
    expect(poolConfigs[1]).toEqual(expect.objectContaining({ ClientId: 'registration-client-id' }));
  });

  it('normalizes a valid public-registration username before Cognito receives it', async () => {
    signUpMock.mockImplementation((_username, _password, _attributes, _validationData, callback) =>
      callback(null, {}),
    );

    await buildClient().registerFirstParent(
      '  Fun-Kid_1 ',
      'StrongPassword123!',
      'parent@example.invalid',
      'gate-secret',
    );

    expect(signUpMock.mock.calls[0]?.[0]).toBe('fun-kid_1');
  });

  it('rejects invalid public-registration usernames before calling Cognito', async () => {
    const result = await buildClient().registerFirstParent(
      'not valid',
      'StrongPassword123!',
      'parent@example.invalid',
      'gate-secret',
    );

    expect(result).toMatchObject({ kind: 'error', field: 'username', recoverable: true });
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 'UsernameExistsException' }, 'username', 'already in use'],
    [
      { code: 'LambdaValidationException', message: 'PreSignUp failed: INVALID_REGISTRATION_GATE' },
      'registrationGatePassword',
      'not valid',
    ],
    [
      { code: 'LambdaValidationException', message: 'PreSignUp failed: REGISTRATION_CLOSED' },
      undefined,
      'closed',
    ],
  ])('maps registration failures safely', async (error, field, message) => {
    signUpMock.mockImplementation((_a, _b, _c, _d, callback) => callback(error));
    const result = await buildClient().registerFirstParent(
      'ParentOne',
      'Password',
      'p@example.invalid',
      'private-gate',
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.field).toBe(field);
      expect(result.message).toContain(message);
      expect(result.message).not.toContain('private-gate');
    }
  });

  it('maps a rejected registration password to the shared policy guidance', async () => {
    signUpMock.mockImplementation((_a, _b, _c, _d, callback) =>
      callback({ code: 'InvalidPasswordException' }),
    );

    const result = await buildClient().registerFirstParent(
      'ParentOne',
      'weak',
      'p@example.invalid',
      'private-gate',
    );

    expect(result).toMatchObject({ kind: 'error', field: 'password', recoverable: true });
    if (result.kind === 'error') expect(result.message).toContain('uppercase letter');
  });

  it('confirms registration and maps invalid or expired codes to field guidance', async () => {
    confirmRegistrationMock.mockImplementation((_code, _forceAlias, callback) =>
      callback({ code: 'ExpiredCodeException' }),
    );
    const result = await buildClient().confirmRegistration('parent', '123456');
    expect(result).toMatchObject({ kind: 'error', field: 'code', recoverable: true });
    expect(cognitoUserConfigs.at(-1)).toEqual(
      expect.objectContaining({
        Pool: expect.objectContaining({
          config: expect.objectContaining({ ClientId: 'registration-client-id' }),
        }),
      }),
    );
  });

  it('resends confirmation codes', async () => {
    resendConfirmationCodeMock.mockImplementation((callback) => callback(null, {}));
    await expect(buildClient().resendConfirmationCode('parent')).resolves.toEqual({
      kind: 'success',
    });
    expect(cognitoUserConfigs.at(-1)).toEqual(
      expect.objectContaining({
        Pool: expect.objectContaining({
          config: expect.objectContaining({ ClientId: 'registration-client-id' }),
        }),
      }),
    );
  });

  it('keeps Forgot Password initiation generic for an unknown username', async () => {
    forgotPasswordMock.mockImplementation((callbacks) =>
      callbacks.onFailure({ code: 'UserNotFoundException' }),
    );
    await expect(buildClient().forgotPassword('unknown')).resolves.toEqual({ kind: 'success' });
  });

  it('confirms a Forgot Password recovery code and maps weak passwords', async () => {
    confirmPasswordMock.mockImplementation((_code, _password, callbacks) =>
      callbacks.onFailure({ code: 'InvalidPasswordException' }),
    );
    const result = await buildClient().confirmForgotPassword('parent', '123456', 'weak');
    expect(result).toMatchObject({ kind: 'error', field: 'password', recoverable: true });
    if (result.kind === 'error') expect(result.message).toContain('uppercase letter');
  });

  it('returns a generic invalid-credentials error for incorrect username or password', async () => {
    authenticateUserMock.mockImplementation((_details, callbacks: MockCallbacks) => {
      callbacks.onFailure({ code: 'NotAuthorizedException' });
    });

    const result = await buildClient().signIn('parent1', 'wrong-password');

    expect(result).toEqual({
      kind: 'error',
      message: 'Incorrect username or password.',
      recoverable: true,
    });
  });

  it('maps UserNotFoundException to the exact same result as NotAuthorizedException', async () => {
    authenticateUserMock.mockImplementation((_details, callbacks: MockCallbacks) => {
      callbacks.onFailure({ code: 'UserNotFoundException' });
    });
    const notFoundResult = await buildClient().signIn('nobody', 'whatever');

    authenticateUserMock.mockImplementation((_details, callbacks: MockCallbacks) => {
      callbacks.onFailure({ code: 'NotAuthorizedException' });
    });
    const wrongPasswordResult = await buildClient().signIn('parent1', 'wrong');

    expect(notFoundResult).toEqual(wrongPasswordResult);
  });

  it('getIdToken returns null before sign-in and the JWT after a successful sign-in', async () => {
    const client = buildClient();
    expect(client.getIdToken()).toBeNull();

    const session = buildSession({ idToken: 'fresh-token' });
    authenticateUserMock.mockImplementation((_details, callbacks: MockCallbacks) => {
      callbacks.onSuccess(session);
    });
    await client.signIn('parent1', 'correct-password');

    getSignInUserSessionMock.mockReturnValue(session);
    expect(client.getIdToken()).toBe('fresh-token');
  });

  it('requireIdToken centralizes the missing-session guard for authenticated actions', async () => {
    const client = buildClient();
    expect(() => client.requireIdToken()).toThrow(AuthSessionUnavailableError);

    const session = buildSession({ idToken: 'fresh-token' });
    authenticateUserMock.mockImplementation((_details, callbacks: MockCallbacks) => {
      callbacks.onSuccess(session);
    });
    await client.signIn('parent1', 'correct-password');
    getSignInUserSessionMock.mockReturnValue(session);

    expect(client.requireIdToken()).toBe('fresh-token');
  });

  it('signOut clears the current user so getIdToken returns null again', async () => {
    const client = buildClient();
    const session = buildSession();
    authenticateUserMock.mockImplementation((_details, callbacks: MockCallbacks) => {
      callbacks.onSuccess(session);
    });
    await client.signIn('parent1', 'correct-password');

    client.signOut();

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(client.getIdToken()).toBeNull();
  });

  it('restores a valid Cognito session from injected storage', async () => {
    const session = buildSession({ idToken: 'restored-token' });
    const restoredUser = {
      getSession: (callback: (error: unknown, value: unknown) => void) => callback(null, session),
      getSignInUserSession: () => session,
      signOut: signOutMock,
    };
    getCurrentUserMock.mockReturnValue(restoredUser);

    const client = buildClient();
    const restored = await client.restoreSession();

    expect(restored?.idToken).toBe('restored-token');
    expect(client.getIdToken()).toBe('restored-token');
  });

  it('clears Cognito session keys when restoration fails', async () => {
    sessionStorage.setItem('CognitoIdentityServiceProvider.client-id.LastAuthUser', 'parent1');
    sessionStorage.setItem(
      'CognitoIdentityServiceProvider.client-id.parent1.idToken',
      'private-token',
    );
    sessionStorage.setItem('unrelated', 'keep-me');
    getCurrentUserMock.mockReturnValue({
      getSession: (callback: (error: unknown) => void) =>
        callback({ code: 'NotAuthorizedException' }),
    });

    await expect(buildClient().restoreSession()).rejects.toBeInstanceOf(AuthSessionEndedError);
    expect(
      sessionStorage.getItem('CognitoIdentityServiceProvider.client-id.LastAuthUser'),
    ).toBeNull();
    expect(
      sessionStorage.getItem('CognitoIdentityServiceProvider.client-id.parent1.idToken'),
    ).toBeNull();
    expect(sessionStorage.getItem('unrelated')).toBe('keep-me');
  });

  it('retains renewable credentials on transport and throttling failures', async () => {
    for (const code of ['NetworkingError', 'TooManyRequestsException']) {
      sessionStorage.setItem(
        'CognitoIdentityServiceProvider.client-id.parent.idToken',
        'private-token',
      );
      getCurrentUserMock.mockReturnValue({
        getSession: (callback: (error: unknown) => void) =>
          callback({ code, message: 'private diagnostic' }),
      });
      await expect(buildClient().restoreSession()).rejects.toBeInstanceOf(
        AuthProviderUnavailableError,
      );
      expect(
        sessionStorage.getItem('CognitoIdentityServiceProvider.client-id.parent.idToken'),
      ).toBe('private-token');
    }
  });

  it('uses the SDK refresh callback and retains distinct terminal renewal failure', async () => {
    const original = buildSession();
    authenticateUserMock.mockImplementation((_details, callbacks: MockCallbacks) =>
      callbacks.onSuccess(original),
    );
    getSignInUserSessionMock.mockReturnValue(original);
    const client = buildClient();
    await client.signIn('parent', 'form-local-password');
    refreshSessionMock.mockImplementation((_token, callback) =>
      callback(null, buildSession({ idToken: 'renewed-id' })),
    );
    expect((await client.renewSession())?.idToken).toBe('renewed-id');
    expect(refreshSessionMock).toHaveBeenCalledOnce();
    refreshSessionMock.mockImplementation((_token, callback) =>
      callback({ code: 'NotAuthorizedException', message: 'private diagnostic' }, null),
    );
    await expect(client.renewSession()).rejects.toBeInstanceOf(AuthSessionEndedError);
  });

  it('signOut removes all app-client auth keys, including a restored user session', () => {
    sessionStorage.setItem('CognitoIdentityServiceProvider.client-id.LastAuthUser', 'parent1');
    sessionStorage.setItem(
      'CognitoIdentityServiceProvider.client-id.parent1.accessToken',
      'private-token',
    );
    sessionStorage.setItem('todone.auth.client-id.localSession', '{"idToken":"private"}');
    sessionStorage.setItem('unrelated', 'keep-me');
    getCurrentUserMock.mockReturnValue({ signOut: signOutMock });

    const client = buildClient();
    client.signOut();

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect([...Array(sessionStorage.length)].map((_, index) => sessionStorage.key(index))).toEqual([
      'unrelated',
    ]);
    expect(localStorage).toHaveLength(0);
  });
});

describe('AuthClient (LOCAL DEVELOPMENT ONLY, localEndpoint set)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    authenticateUserMock.mockReset();
    signOutMock.mockReset();
    getSignInUserSessionMock.mockReset();
    getSessionMock.mockReset();
    refreshSessionMock.mockReset();
    getCurrentUserMock.mockReset();
    signUpMock.mockReset();
    confirmRegistrationMock.mockReset();
    resendConfirmationCodeMock.mockReset();
    forgotPasswordMock.mockReset();
    confirmPasswordMock.mockReset();
    sendMock.mockReset();
    poolConfigs.length = 0;
    cognitoUserConfigs.length = 0;
  });

  it('uses USER_PASSWORD_AUTH instead of SRP, and never calls authenticateUser', async () => {
    sendMock.mockResolvedValue({
      AuthenticationResult: {
        IdToken: 'local-id-token',
        AccessToken: 'local-access-token',
        ExpiresIn: 3600,
      },
    });

    const result = await buildLocalClient().signIn('localdev', 'LocalDevPass123!');

    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.session.idToken).toBe('local-id-token');
      expect(result.session.accessToken).toBe('local-access-token');
    }
    expect(authenticateUserMock).not.toHaveBeenCalled();
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: 'local-client-id',
          AuthParameters: { USERNAME: 'localdev', PASSWORD: 'LocalDevPass123!' },
        }),
      }),
    );
  });

  it('maps a cognito-local NotAuthorizedException to the same generic invalid-credentials result', async () => {
    sendMock.mockRejectedValue({ name: 'NotAuthorizedException' });

    const result = await buildLocalClient().signIn('localdev', 'wrong-password');

    expect(result).toEqual({
      kind: 'error',
      message: 'Incorrect username or password.',
      recoverable: true,
    });
  });

  it('getIdToken and signOut work against the local session, independent of the SRP CognitoUser path', async () => {
    sendMock.mockResolvedValue({
      AuthenticationResult: {
        IdToken: 'local-id-token',
        AccessToken: 'local-access-token',
        ExpiresIn: 3600,
      },
    });

    const client = buildLocalClient();
    expect(client.getIdToken()).toBeNull();

    await client.signIn('localdev', 'LocalDevPass123!');
    expect(client.getIdToken()).toBe('local-id-token');

    client.signOut();
    expect(client.getIdToken()).toBeNull();
    // The local path never touches the SRP CognitoUser at all.
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it('roundtrips local SDK credentials through injected storage and clears them on sign-out', async () => {
    sendMock.mockResolvedValue({
      AuthenticationResult: {
        IdToken: 'local-id-token',
        AccessToken: 'local-access-token',
        ExpiresIn: 3600,
      },
    });
    await buildLocalClient().signIn('localdev', 'LocalDevPass123!');

    expect(localStorage).toHaveLength(0);
    const reloadedClient = buildLocalClient();
    const restored = await reloadedClient.restoreSession();
    expect(restored?.idToken).toBe('local-id-token');

    reloadedClient.signOut();
    expect(await buildLocalClient().restoreSession()).toBeNull();
  });

  it('restores an expired local session using the retained refresh credential', async () => {
    sessionStorage.setItem(
      'todone.auth.local-client-id.localSession',
      JSON.stringify({
        idToken: 'expired-id',
        accessToken: 'expired-access',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        refreshToken: 'synthetic-refresh',
      }),
    );
    sendMock.mockResolvedValue({
      AuthenticationResult: {
        IdToken: 'renewed-id',
        AccessToken: 'renewed-access',
        ExpiresIn: 3600,
      },
    });
    expect((await buildLocalClient().restoreSession())?.idToken).toBe('renewed-id');
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          ClientId: 'local-client-id',
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          AuthParameters: { REFRESH_TOKEN: 'synthetic-refresh' },
        },
      }),
    );
    expect(
      JSON.parse(sessionStorage.getItem('todone.auth.local-client-id.localSession')!).refreshToken,
    ).toBe('synthetic-refresh');
  });

  it('never extends local credential lifetime beyond either JWT expiry', async () => {
    const expiry = Math.floor(Date.now() / 1000) + 90;
    const id = `header.${btoa(JSON.stringify({ exp: expiry }))}.signature`;
    const access = `header.${btoa(JSON.stringify({ exp: expiry + 60 }))}.signature`;
    sendMock.mockResolvedValue({
      AuthenticationResult: { IdToken: id, AccessToken: access, ExpiresIn: 3600 },
    });
    const result = await buildLocalClient().signIn('localdev', 'LocalDevPass123!');
    expect(result).toMatchObject({
      kind: 'success',
      session: { expiresAt: new Date(expiry * 1000) },
    });
  });

  it('recognizes a known-expired JWT despite a later saved expiry value', async () => {
    const expired = `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 1 }))}.signature`;
    sessionStorage.setItem(
      'todone.auth.local-client-id.localSession',
      JSON.stringify({
        idToken: expired,
        accessToken: expired,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    );
    expect(await buildLocalClient().restoreSession()).toBeNull();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects and removes an expired local session', async () => {
    sessionStorage.setItem(
      'todone.auth.local-client-id.localSession',
      JSON.stringify({
        idToken: 'expired-id-token',
        accessToken: 'expired-access-token',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    expect(await buildLocalClient().restoreSession()).toBeNull();
    expect(sessionStorage.getItem('todone.auth.local-client-id.localSession')).toBeNull();
  });
});
