import { ParentAccountApi } from '../../shared/familyAccountContract';
import {
  APPLICATION_JSON,
  fetchAuthenticatedJson,
  HttpHeader,
  HttpMethod,
  type CredentialSource,
} from './apiClient';
import type { FamilyMember } from './familyClient';
import { messages } from '../i18n/messages';
export type ParentAccountResult =
  | { kind: 'success'; member?: FamilyMember }
  | {
      kind: 'error';
      code?: string;
      message: string;
      recoverable: boolean;
      conflict: boolean;
      fieldErrors?: Array<{ field: string; message: string }>;
    };
async function send(
  url: string,
  credentials: CredentialSource,
  method: string,
  input?: unknown,
  key?: string,
): Promise<ParentAccountResult> {
  try {
    const { response, body } = await fetchAuthenticatedJson<{
      member?: FamilyMember;
      error?: {
        code?: string;
        message?: string;
        fieldErrors?: Array<{ field: string; message: string }>;
      };
    }>(url, credentials, {
      method,
      headers: {
        ...(input === undefined ? {} : { [HttpHeader.contentType]: APPLICATION_JSON }),
        ...(key ? { [HttpHeader.idempotencyKey]: key } : {}),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    });
    if (response.ok) return { kind: 'success', ...(body?.member ? { member: body.member } : {}) };
    return {
      kind: 'error',
      code: body?.error?.code,
      message: body?.error?.message ?? messages.parentAccounts.uncertain,
      recoverable: response.status < 500 && response.status !== 401,
      conflict: response.status === 409 || response.status === 403,
      ...(body?.error?.fieldErrors ? { fieldErrors: body.error.fieldErrors } : {}),
    };
  } catch {
    return {
      kind: 'error',
      message: messages.parentAccounts.uncertain,
      recoverable: false,
      conflict: false,
    };
  }
}
export function createParent(
  credentials: CredentialSource,
  input: { username: string; email: string },
  key: string,
) {
  return send(ParentAccountApi.create, credentials, HttpMethod.post, input, key);
}
export function activateParent(credentials: CredentialSource) {
  return send(ParentAccountApi.activation, credentials, HttpMethod.post);
}
export function mutatePendingParent(
  credentials: CredentialSource,
  memberId: string,
  action: 'resend' | 'email' | 'cancel',
  key: string,
  email?: string,
) {
  return send(
    ParentAccountApi[action](memberId),
    credentials,
    action === 'email' ? HttpMethod.put : action === 'cancel' ? 'DELETE' : HttpMethod.post,
    action === 'email' ? { email } : action === 'cancel' ? { confirmation: true } : undefined,
    key,
  );
}

export async function readRecoveryEmail(
  credentials: CredentialSource,
): Promise<{ kind: 'success'; email: string } | { kind: 'error'; message: string }> {
  try {
    const { response, body } = await fetchAuthenticatedJson<{
      email?: string;
      error?: { message?: string };
    }>(ParentAccountApi.recoveryEmail, credentials, { method: HttpMethod.get });
    if (response.ok && typeof body?.email === 'string')
      return { kind: 'success', email: body.email };
    return { kind: 'error', message: body?.error?.message ?? messages.parentAccounts.unavailable };
  } catch {
    return { kind: 'error', message: messages.generic.networkError };
  }
}
export function replaceRecoveryEmail(credentials: CredentialSource, email: string) {
  return send(ParentAccountApi.recoveryEmail, credentials, HttpMethod.put, { email });
}

export function removeChild(credentials: CredentialSource, memberId: string, key: string) {
  return send(
    ParentAccountApi.removeChild(memberId),
    credentials,
    'DELETE',
    { confirmation: true },
    key,
  );
}
