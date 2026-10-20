import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
} from 'amazon-cognito-identity-js';
import type { AuthConfig } from '../config/authConfig';
import { messages } from '../i18n/messages';
import { getErrorCode, getErrorMessage, mapAuthError } from './authErrors';
import { isValidUsername, normalizeUsernameForCognito } from './username';
import {
  AuthProviderUnavailableError,
  AuthSessionEndedError,
  AuthStorageUnavailableError,
  isTerminalProviderFailure,
} from './authSessionErrors';

const CognitoErrorCode = {
  invalidPassword: 'InvalidPasswordException',
  usernameExists: 'UsernameExistsException',
} as const;

export interface AuthSession {
  idToken: string;
  accessToken: string;
  expiresAt: Date;
}

export type SignInResult =
  | { kind: 'success'; session: AuthSession }
  | { kind: 'error'; message: string; recoverable: boolean };

export type AuthActionResult =
  | { kind: 'success' }
  | {
      kind: 'error';
      message: string;
      recoverable: boolean;
      field?: 'username' | 'email' | 'registrationGatePassword' | 'code' | 'password';
    };

/** Signals that an authenticated API action cannot safely proceed in this tab. */
export class AuthSessionUnavailableError extends Error {
  readonly name = 'AuthSessionUnavailableError';
}

/**
 * Thin, typed wrapper around amazon-cognito-identity-js using username/JWT
 * terminology throughout (never "email"), matching the replacement Cognito
 * pool's username/password sign-in model (ADR 0002).
 *
 * When `config.localEndpoint` is set (LOCAL DEVELOPMENT ONLY, see
 * scripts/setup-local-cognito.ts), sign-in instead goes through
 * cognito-local's USER_PASSWORD_AUTH flow via the raw Cognito API, because
 * cognito-local does not implement SRP. Real Cognito always uses SRP; this
 * branch is unreachable unless a developer has explicitly bootstrapped a
 * local pool.
 *
 * This client performs authentication only. The app session controller owns
 * lifecycle/context; each provider operation injects its bound storage scope.
 */
export class AuthClient {
  private readonly config: AuthConfig;
  private readonly authenticatedPool: CognitoUserPool;
  private readonly registrationPool: CognitoUserPool;
  private readonly storage: Storage;
  private currentUser: CognitoUser | null = null;
  private localSession: AuthSession | null = null;
  private localRefreshToken: string | null = null;

  constructor(config: AuthConfig, storage: Storage) {
    this.config = config;
    this.storage = storage;
    this.authenticatedPool = new CognitoUserPool({
      UserPoolId: config.userPoolId,
      ClientId: config.clientId,
      Storage: this.storage,
    });
    this.registrationPool = new CognitoUserPool({
      UserPoolId: config.userPoolId,
      ClientId: config.registrationClientId,
      Storage: this.storage,
    });
  }

  async signIn(username: string, password: string): Promise<SignInResult> {
    if (this.config.localEndpoint) {
      return this.signInLocal(username, password);
    }
    return this.signInSrp(username, password);
  }

  async registerFirstParent(
    username: string,
    password: string,
    email: string,
    registrationGatePassword: string,
  ): Promise<AuthActionResult> {
    const canonicalUsername = normalizeUsernameForCognito(username);
    if (!isValidUsername(canonicalUsername)) {
      return {
        kind: 'error',
        field: 'username',
        message: messages.bootstrap.usernamePolicyError,
        recoverable: true,
      };
    }
    if (this.config.localEndpoint) {
      return this.registerLocal(canonicalUsername, password, email, registrationGatePassword);
    }
    return new Promise((resolve) => {
      this.registrationPool.signUp(
        canonicalUsername,
        password,
        [new CognitoUserAttribute({ Name: 'email', Value: email })],
        [
          new CognitoUserAttribute({
            Name: 'registrationGatePassword',
            Value: registrationGatePassword,
          }),
        ],
        (error) => resolve(error ? registrationError(error) : { kind: 'success' }),
      );
    });
  }

  async confirmRegistration(username: string, code: string): Promise<AuthActionResult> {
    if (this.config.localEndpoint) {
      return this.confirmRegistrationLocal(username, code);
    }
    return new Promise((resolve) => {
      this.registrationUser(username).confirmRegistration(code, true, (error) =>
        resolve(error ? confirmationError(error) : { kind: 'success' }),
      );
    });
  }

  async resendConfirmationCode(username: string): Promise<AuthActionResult> {
    if (this.config.localEndpoint) {
      return this.resendConfirmationCodeLocal(username);
    }
    return new Promise((resolve) => {
      this.registrationUser(username).resendConfirmationCode((error) =>
        resolve(error ? confirmationError(error) : { kind: 'success' }),
      );
    });
  }

  async forgotPassword(username: string): Promise<AuthActionResult> {
    if (this.config.localEndpoint) {
      return this.forgotPasswordLocal(username);
    }
    return new Promise((resolve) => {
      this.user(username).forgotPassword({
        inputVerificationCode: () => resolve({ kind: 'success' }),
        onSuccess: () => resolve({ kind: 'success' }),
        onFailure: (error) => {
          // Initiation remains generic and does not disclose whether an account exists.
          resolve(
            getErrorCode(error) === 'UserNotFoundException'
              ? { kind: 'success' }
              : { kind: 'error', ...mapAuthError(error) },
          );
        },
      });
    });
  }

  async confirmForgotPassword(
    username: string,
    code: string,
    newPassword: string,
  ): Promise<AuthActionResult> {
    if (this.config.localEndpoint) {
      return this.confirmForgotPasswordLocal(username, code, newPassword);
    }
    return new Promise((resolve) => {
      this.user(username).confirmPassword(code, newPassword, {
        onSuccess: () => resolve({ kind: 'success' }),
        onFailure: (error) => resolve(passwordResetError(error)),
      });
    });
  }

  signOut(): void {
    try {
      if (!this.config.localEndpoint) {
        (this.currentUser ?? this.authenticatedPool.getCurrentUser())?.signOut();
      }
    } finally {
      // Sign-out is a local privacy boundary. Cognito SDK errors must not
      // leave this bound scope's credentials behind.
      this.currentUser = null;
      this.localSession = null;
      this.localRefreshToken = null;
      this.clearStoredSession();
    }
  }

  /** The SDK getSession callback returns cached credentials or renews expired ones. */
  async restoreSession(): Promise<AuthSession | null> {
    if (this.config.localEndpoint) {
      return this.restoreLocalSession();
    }

    const user = this.authenticatedPool.getCurrentUser();
    if (!user) {
      this.clearStoredSession();
      return null;
    }

    return new Promise<AuthSession | null>((resolve, reject) => {
      user.getSession((error: Error | null, cognitoSession: CognitoUserSession | null) => {
        if (error) {
          reject(this.sessionFailure(error));
          return;
        }
        if (!cognitoSession) {
          reject(new AuthStorageUnavailableError());
          return;
        }

        const session = toAuthSession(cognitoSession);
        if (!Number.isFinite(session.expiresAt.getTime())) {
          reject(new AuthStorageUnavailableError());
          return;
        }
        if (session.expiresAt.getTime() <= Date.now()) {
          this.clearStoredSession();
          reject(new AuthSessionEndedError());
          return;
        }

        this.currentUser = user;
        resolve(session);
      });
    });
  }

  /** Cognito expects REFRESH_TOKEN_AUTH; refreshSession caches before invoking its callback. */
  async renewSession(): Promise<AuthSession | null> {
    if (this.config.localEndpoint) return this.renewLocalSession();
    const user = this.currentUser;
    if (!user) return this.restoreSession();
    const refreshToken = user.getSignInUserSession()?.getRefreshToken();
    if (!refreshToken?.getToken()) {
      this.clearStoredSession();
      throw new AuthSessionEndedError();
    }
    return new Promise((resolve, reject) => {
      user.refreshSession(refreshToken, (error, session) => {
        if (error) {
          reject(this.sessionFailure(error));
          return;
        }
        if (!session) {
          reject(new AuthProviderUnavailableError());
          return;
        }
        const credentials = toAuthSession(session);
        if (credentials.expiresAt.getTime() <= Date.now()) {
          reject(new AuthSessionEndedError());
          return;
        }
        resolve(credentials);
      });
    });
  }

  private sessionFailure(error: unknown): Error {
    if (error instanceof AuthStorageUnavailableError) return error;
    if (isTerminalProviderFailure(error)) {
      this.clearStoredSession();
      this.currentUser = null;
      this.localSession = null;
      this.localRefreshToken = null;
      return new AuthSessionEndedError();
    }
    return new AuthProviderUnavailableError();
  }

  /** The local emulator supports the same refresh flow through its raw InitiateAuth API. */
  private async renewLocalSession(): Promise<AuthSession | null> {
    if (!this.localRefreshToken) {
      this.clearStoredSession();
      throw new AuthSessionEndedError();
    }
    const { InitiateAuthCommand } = await import('@aws-sdk/client-cognito-identity-provider');
    const client = await this.localCognitoClient();
    try {
      const response = await client.send(
        new InitiateAuthCommand({
          ClientId: this.config.clientId,
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          AuthParameters: { REFRESH_TOKEN: this.localRefreshToken },
        }),
      );
      const result = response.AuthenticationResult;
      if (!result?.IdToken || !result.AccessToken) throw new AuthProviderUnavailableError();
      const session = localAuthSession(result.IdToken, result.AccessToken, result.ExpiresIn);
      this.localRefreshToken = result.RefreshToken ?? this.localRefreshToken;
      this.storage.setItem(
        this.localSessionKey(),
        serializeSession(session, this.localRefreshToken),
      );
      this.localSession = session;
      return session;
    } catch (error) {
      throw this.sessionFailure(error);
    }
  }

  /** Returns the current ID token JWT for use as a bearer token, or null if signed out. */
  getIdToken(): string | null {
    if (this.localSession) {
      return this.localSession.idToken;
    }
    return this.currentUser?.getSignInUserSession()?.getIdToken().getJwtToken() ?? null;
  }

  /** Returns a current token or makes the caller take the one shared session-ended path. */
  requireIdToken(): string {
    const token = this.getIdToken();
    if (!token) throw new AuthSessionUnavailableError();
    return token;
  }

  private async signInSrp(username: string, password: string): Promise<SignInResult> {
    // CognitoUser does not inherit Storage from its pool; bind every SDK write.
    const user = new CognitoUser({
      Username: username,
      Pool: this.authenticatedPool,
      Storage: this.storage,
    });
    const authDetails = new AuthenticationDetails({ Username: username, Password: password });

    return new Promise<SignInResult>((resolve) => {
      user.authenticateUser(authDetails, {
        onSuccess: (session: CognitoUserSession) => {
          this.currentUser = user;
          resolve({ kind: 'success', session: toAuthSession(session) });
        },
        onFailure: (err: unknown) => {
          resolve({ kind: 'error', ...mapAuthError(err) });
        },
      });
    });
  }

  private user(username: string): CognitoUser {
    return new CognitoUser({
      Username: username,
      Pool: this.authenticatedPool,
      Storage: this.storage,
    });
  }

  private registrationUser(username: string): CognitoUser {
    return new CognitoUser({
      Username: username,
      Pool: this.registrationPool,
      Storage: this.storage,
    });
  }

  private async registerLocal(
    username: string,
    password: string,
    email: string,
    registrationGatePassword: string,
  ): Promise<AuthActionResult> {
    const { SignUpCommand } = await import('@aws-sdk/client-cognito-identity-provider');
    const client = await this.localCognitoClient();
    try {
      await client.send(
        new SignUpCommand({
          ClientId: this.config.registrationClientId,
          Username: username,
          Password: password,
          UserAttributes: [{ Name: 'email', Value: email }],
          ValidationData: [{ Name: 'registrationGatePassword', Value: registrationGatePassword }],
        }),
      );
      return { kind: 'success' };
    } catch (error) {
      return registrationError(error);
    }
  }

  private async signInLocal(username: string, password: string): Promise<SignInResult> {
    // Dynamically imported so this heavier SDK client never lands in the
    // production bundle for the (default) SRP path.
    const { InitiateAuthCommand } = await import('@aws-sdk/client-cognito-identity-provider');
    const client = await this.localCognitoClient();

    try {
      const response = await client.send(
        new InitiateAuthCommand({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: this.config.clientId,
          AuthParameters: { USERNAME: username, PASSWORD: password },
        }),
      );

      const result = response.AuthenticationResult;
      if (!result?.IdToken || !result.AccessToken) {
        return {
          kind: 'error',
          message: messages.generic.unexpectedError,
          recoverable: true,
        };
      }

      const session = localAuthSession(result.IdToken, result.AccessToken, result.ExpiresIn);
      this.localSession = session;
      this.localRefreshToken = result.RefreshToken ?? null;
      this.storage.setItem(
        this.localSessionKey(),
        serializeSession(session, this.localRefreshToken),
      );
      return { kind: 'success', session };
    } catch (err) {
      return { kind: 'error', ...mapAuthError(err) };
    }
  }

  /** Cognito Local does not support the browser SDK's default AWS endpoint. */
  private async confirmRegistrationLocal(
    username: string,
    code: string,
  ): Promise<AuthActionResult> {
    const { ConfirmSignUpCommand } = await import('@aws-sdk/client-cognito-identity-provider');
    const client = await this.localCognitoClient();
    try {
      await client.send(
        new ConfirmSignUpCommand({
          ClientId: this.config.registrationClientId,
          Username: username,
          ConfirmationCode: code,
        }),
      );
      return { kind: 'success' };
    } catch (error) {
      return confirmationError(error);
    }
  }

  private async resendConfirmationCodeLocal(username: string): Promise<AuthActionResult> {
    const { ResendConfirmationCodeCommand } =
      await import('@aws-sdk/client-cognito-identity-provider');
    const client = await this.localCognitoClient();
    try {
      await client.send(
        new ResendConfirmationCodeCommand({
          ClientId: this.config.registrationClientId,
          Username: username,
        }),
      );
      return { kind: 'success' };
    } catch (error) {
      return confirmationError(error);
    }
  }

  private async forgotPasswordLocal(username: string): Promise<AuthActionResult> {
    const { ForgotPasswordCommand } = await import('@aws-sdk/client-cognito-identity-provider');
    const client = await this.localCognitoClient();
    try {
      await client.send(
        new ForgotPasswordCommand({ ClientId: this.config.clientId, Username: username }),
      );
      return { kind: 'success' };
    } catch (error) {
      return getErrorCode(error) === 'UserNotFoundException'
        ? { kind: 'success' }
        : { kind: 'error', ...mapAuthError(error) };
    }
  }

  private async confirmForgotPasswordLocal(
    username: string,
    code: string,
    newPassword: string,
  ): Promise<AuthActionResult> {
    const { ConfirmForgotPasswordCommand } =
      await import('@aws-sdk/client-cognito-identity-provider');
    const client = await this.localCognitoClient();
    try {
      await client.send(
        new ConfirmForgotPasswordCommand({
          ClientId: this.config.clientId,
          Username: username,
          ConfirmationCode: code,
          Password: newPassword,
        }),
      );
      return { kind: 'success' };
    } catch (error) {
      return passwordResetError(error);
    }
  }

  private async localCognitoClient() {
    const { CognitoIdentityProviderClient } =
      await import('@aws-sdk/client-cognito-identity-provider');
    return new CognitoIdentityProviderClient({
      region: this.config.region,
      endpoint: this.config.localEndpoint,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    });
  }

  private async restoreLocalSession(): Promise<AuthSession | null> {
    const stored = this.storage.getItem(this.localSessionKey());
    if (!stored) {
      return null;
    }

    try {
      const value = JSON.parse(stored) as Partial<{
        idToken: unknown;
        accessToken: unknown;
        expiresAt: unknown;
        refreshToken: unknown;
      }>;
      if (
        typeof value.idToken !== 'string' ||
        typeof value.accessToken !== 'string' ||
        typeof value.expiresAt !== 'string'
      ) {
        throw new Error('Invalid stored session');
      }

      const session: AuthSession = {
        idToken: value.idToken,
        accessToken: value.accessToken,
        expiresAt: new Date(
          Math.min(
            new Date(value.expiresAt).getTime(),
            jwtExpiration(value.idToken),
            jwtExpiration(value.accessToken),
          ),
        ),
      };
      if (!Number.isFinite(session.expiresAt.getTime())) throw new AuthStorageUnavailableError();
      this.localRefreshToken = typeof value.refreshToken === 'string' ? value.refreshToken : null;
      if (session.expiresAt.getTime() <= Date.now()) {
        if (!this.localRefreshToken) {
          this.clearStoredSession();
          return null;
        }
        return this.renewLocalSession();
      }
      this.localSession = session;
      return session;
    } catch {
      this.clearStoredSession();
      throw new AuthStorageUnavailableError();
    }
  }

  private localSessionKey(): string {
    return `todone.auth.${this.config.clientId}.localSession`;
  }

  private clearStoredSession(): void {
    const cognitoPrefix = `CognitoIdentityServiceProvider.${this.config.clientId}.`;
    const keysToRemove: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key && (key.startsWith(cognitoPrefix) || key === this.localSessionKey())) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => this.storage.removeItem(key));
  }
}

function registrationError(error: unknown): Extract<AuthActionResult, { kind: 'error' }> {
  const code = getErrorCode(error);
  const message = getErrorMessage(error) ?? '';
  if (code === CognitoErrorCode.usernameExists) {
    return {
      kind: 'error',
      field: 'username',
      message: 'That username is already in use.',
      recoverable: true,
    };
  }
  if (message.includes('REGISTRATION_CLOSED')) {
    return { kind: 'error', message: 'Registration is currently closed.', recoverable: false };
  }
  if (message.includes('INVALID_REGISTRATION_GATE')) {
    return {
      kind: 'error',
      field: 'registrationGatePassword',
      message: messages.bootstrap.entryCodeInvalid,
      recoverable: true,
    };
  }
  if (code === CognitoErrorCode.invalidPassword) {
    return {
      kind: 'error',
      field: 'password',
      message: messages.bootstrap.passwordPolicyError,
      recoverable: true,
    };
  }
  return { kind: 'error', ...mapAuthError(error) };
}

function confirmationError(error: unknown): Extract<AuthActionResult, { kind: 'error' }> {
  const code = getErrorCode(error);
  if (code === 'CodeMismatchException' || code === 'ExpiredCodeException') {
    return {
      kind: 'error',
      field: 'code',
      message: 'That verification code is invalid or expired. Request a new code and try again.',
      recoverable: true,
    };
  }
  return { kind: 'error', ...mapAuthError(error) };
}

function passwordResetError(error: unknown): Extract<AuthActionResult, { kind: 'error' }> {
  if (getErrorCode(error) === CognitoErrorCode.invalidPassword) {
    return {
      kind: 'error',
      field: 'password',
      message: messages.bootstrap.passwordPolicyError,
      recoverable: true,
    };
  }
  return confirmationError(error);
}

function toAuthSession(session: CognitoUserSession): AuthSession {
  return {
    idToken: session.getIdToken().getJwtToken(),
    accessToken: session.getAccessToken().getJwtToken(),
    expiresAt: new Date(
      Math.min(session.getIdToken().getExpiration(), session.getAccessToken().getExpiration()) *
        1000,
    ),
  };
}

function serializeSession(session: AuthSession, refreshToken: string | null = null): string {
  return JSON.stringify({
    idToken: session.idToken,
    accessToken: session.accessToken,
    expiresAt: session.expiresAt.toISOString(),
    ...(refreshToken ? { refreshToken } : {}),
  });
}

const JWT_EXPIRATION_CLAIM = 'exp';
const SECONDS_TO_MILLISECONDS = 1000;
const DEFAULT_LOCAL_TOKEN_SECONDS = 3600;
function jwtExpiration(token: string): number {
  try {
    const encoded = token.split('.')[1];
    if (!encoded) return Number.POSITIVE_INFINITY;
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const claims: unknown = JSON.parse(
      globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')),
    );
    if (!claims || typeof claims !== 'object' || !(JWT_EXPIRATION_CLAIM in claims))
      return Number.POSITIVE_INFINITY;
    const seconds = claims[JWT_EXPIRATION_CLAIM];
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return Number.POSITIVE_INFINITY;
    return seconds * SECONDS_TO_MILLISECONDS;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
function localAuthSession(idToken: string, accessToken: string, expiresIn?: number): AuthSession {
  const responseExpiry =
    Date.now() + (expiresIn ?? DEFAULT_LOCAL_TOKEN_SECONDS) * SECONDS_TO_MILLISECONDS;
  return {
    idToken,
    accessToken,
    expiresAt: new Date(
      Math.min(responseExpiry, jwtExpiration(idToken), jwtExpiration(accessToken)),
    ),
  };
}
