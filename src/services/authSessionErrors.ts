import { getErrorCode } from './authErrors';
const AUTH_PROVIDER_UNAVAILABLE = 'AUTH_PROVIDER_UNAVAILABLE';
const AUTH_STORAGE_UNAVAILABLE = 'AUTH_STORAGE_UNAVAILABLE';
const AUTH_SESSION_ENDED = 'AUTH_SESSION_ENDED';

/** Internal typed signals only; render catalog copy, never these diagnostics. */
export class AuthProviderUnavailableError extends Error {
  constructor() {
    super(AUTH_PROVIDER_UNAVAILABLE);
  }
}
export class AuthStorageUnavailableError extends Error {
  constructor() {
    super(AUTH_STORAGE_UNAVAILABLE);
  }
}
export class AuthSessionEndedError extends Error {
  constructor() {
    super(AUTH_SESSION_ENDED);
  }
}

export function isTerminalProviderFailure(error: unknown): boolean {
  const code = getErrorCode(error);
  return code === 'NotAuthorizedException' || code === 'UserNotFoundException';
}
