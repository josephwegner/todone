import type { ApiResult } from './apiResult';
import { CurrentMembershipApi } from '../../shared/membershipContract';
import { SessionOperationCancelledError } from '../session/sessionErrors';

export const HttpHeader = {
  accept: 'accept',
  authorization: 'authorization',
  contentType: 'content-type',
  idempotencyKey: 'idempotency-key',
} as const;
export const APPLICATION_JSON = 'application/json';
export const HttpMethod = { get: 'GET', post: 'POST', put: 'PUT' } as const;
const NO_STORE = 'no-store';

export interface AuthenticatedJsonResponse<T> {
  response: Response;
  body: T | null;
}

export interface AuthenticatedRequestSession {
  credentials(forceRenewal?: boolean): Promise<string>;
  isCurrent(): boolean;
  signal: AbortSignal;
  onResponse?(response: { status: number; code: unknown; url: string }): Promise<void>;
}
export type CredentialSource = string | AuthenticatedRequestSession;

/** Applies the application's non-cacheable bearer-token JSON request contract. */
export async function fetchAuthenticatedJson<T>(
  url: string,
  idToken: CredentialSource,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthenticatedJsonResponse<T>> {
  const session = typeof idToken === 'string' ? null : idToken;
  const requireCurrentGeneration = () => {
    if (session && (!session.isCurrent() || session.signal.aborted))
      throw new SessionOperationCancelledError();
  };
  async function send(forceRenewal: boolean): Promise<AuthenticatedJsonResponse<T>> {
    requireCurrentGeneration();
    const token = session ? await session.credentials(forceRenewal) : idToken;
    requireCurrentGeneration();
    const response = await fetchImpl(url, {
      ...init,
      ...(session ? { signal: session.signal } : {}),
      headers: {
        [HttpHeader.accept]: APPLICATION_JSON,
        ...init.headers,
        [HttpHeader.authorization]: `Bearer ${token}`,
      },
      cache: NO_STORE,
    });
    const body = (await response.json().catch(() => null)) as T | null;
    requireCurrentGeneration();
    return { response, body };
  }
  function errorCode(body: T | null): unknown {
    if (!body || typeof body !== 'object' || !('error' in body)) return null;
    const error = body.error;
    return error && typeof error === 'object' && 'code' in error ? error.code : null;
  }
  let result = await send(false);
  // Only a safe read gets one renewal retry. A sent write retains its endpoint's
  // original idempotency/uncertain-result contract and is never replayed here.
  if (
    session &&
    result.response.status === 401 &&
    errorCode(result.body) !== CurrentMembershipApi.credentialsStale &&
    (init.method ?? HttpMethod.get) === HttpMethod.get
  )
    result = await send(true);
  if (session?.onResponse)
    await session.onResponse({ status: result.response.status, code: errorCode(result.body), url });
  requireCurrentGeneration();
  return result;
}

export interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

/**
 * Typed boundary between the Vue shell and the local API simulator (and,
 * later, the deployed API). Callers never see raw fetch/Response objects;
 * they receive a discriminated result they can render as loading, success,
 * or a recoverable error.
 */
export async function fetchHealth(
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<HealthResponse>> {
  try {
    const response = await fetchImpl('/api/v1/health', {
      method: HttpMethod.get,
      headers: { [HttpHeader.accept]: APPLICATION_JSON },
    });

    if (!response.ok) {
      return {
        kind: 'error',
        message: 'The service is temporarily unavailable. Please try again.',
        recoverable: true,
      };
    }

    const data = (await response.json()) as HealthResponse;
    return { kind: 'success', data };
  } catch {
    return {
      kind: 'error',
      message: 'Could not reach the server. Check your connection and try again.',
      recoverable: true,
    };
  }
}
