import type { CredentialSource } from './apiClient';
import type { ProfileColorId } from '../../shared/profilePalette';
import { messages } from '../i18n/messages';
import { APPLICATION_JSON, fetchAuthenticatedJson, HttpHeader, HttpMethod } from './apiClient';

export type FamilyMemberRole = 'parent' | 'child';
export type FamilyMemberState = 'ACTIVE' | 'PENDING_ACTIVATION';
export type PendingParentAction =
  'RESEND_WELCOME' | 'CHANGE_EMAIL_AND_RESEND' | 'CANCEL_PENDING_ACCOUNT';

export interface FamilyMember {
  memberId: string;
  username: string;
  role: FamilyMemberRole;
  activationState: FamilyMemberState;
  displayName?: string;
  color?: ProfileColorId;
  allowedActions: PendingParentAction[];
}

export type FamilyDirectoryResult =
  | { kind: 'success'; data: { members: FamilyMember[] } }
  | { kind: 'error'; message: string; recoverable: boolean };

export interface CreateChildInput {
  username: string;
  displayName: string;
  color: ProfileColorId;
  password: string;
  idempotencyKey: string;
}

export type CreateChildResult =
  | { kind: 'success'; data: { member: FamilyMember } }
  | {
      kind: 'error';
      message: string;
      recoverable: boolean;
      fieldErrors?: Array<{ field: string; code: string; message: string }>;
    };

export type ResetChildPasswordResult =
  | { kind: 'success' }
  | {
      kind: 'error';
      message: string;
      recoverable: boolean;
      sessionExpired?: boolean;
      fieldErrors?: Array<{ field: string; code: string; message: string }>;
    };

const FamilyApiRoute = {
  members: '/api/v1/family-members',
  children: '/api/v1/family-members/children',
  childPassword: (memberId: string) =>
    `/api/v1/family-members/${encodeURIComponent(memberId)}/password`,
} as const;
const PASSWORD_RESET_UNAVAILABLE = 'PASSWORD_RESET_UNAVAILABLE';

/** Reads the authenticated caller's safe household directory; no target IDs are accepted. */
export async function fetchFamilyMembers(
  idToken: CredentialSource,
  fetchImpl: typeof fetch = fetch,
): Promise<FamilyDirectoryResult> {
  try {
    const { response, body } = await fetchAuthenticatedJson<{
      members?: FamilyMember[];
      error?: { message?: string };
    }>(FamilyApiRoute.members, idToken, { method: HttpMethod.get }, fetchImpl);
    if (response.ok && body?.members) return { kind: 'success', data: { members: body.members } };
    return {
      kind: 'error',
      message:
        response.status === 401
          ? messages.familyClient.sessionEnded
          : (body?.error?.message ?? messages.familyClient.requestFailed),
      recoverable: response.status !== 401,
    };
  } catch {
    return { kind: 'error', message: messages.generic.networkError, recoverable: true };
  }
}

/** Sends the replacement password only in this immediate non-cacheable request. */
export async function resetChildPassword(
  idToken: CredentialSource,
  memberId: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResetChildPasswordResult> {
  try {
    const { response, body } = await fetchAuthenticatedJson<{
      error?: {
        code?: string;
        message?: string;
        fieldErrors?: Array<{ field: string; code: string; message: string }>;
      };
    }>(
      FamilyApiRoute.childPassword(memberId),
      idToken,
      {
        method: HttpMethod.put,
        headers: { [HttpHeader.contentType]: APPLICATION_JSON },
        body: JSON.stringify({ password }),
      },
      fetchImpl,
    );
    if (response.status === 204) return { kind: 'success' };
    return {
      kind: 'error',
      message: body?.error?.message ?? messages.familyClient.requestFailed,
      recoverable:
        response.status !== 401 &&
        (response.status < 500 || body?.error?.code === PASSWORD_RESET_UNAVAILABLE),
      sessionExpired: response.status === 401,
      ...(body?.error?.fieldErrors ? { fieldErrors: body.error.fieldErrors } : {}),
    };
  } catch {
    return { kind: 'error', message: messages.generic.networkError, recoverable: true };
  }
}

/** Sends a child password only in this immediate non-cacheable request. */
export async function createChild(
  idToken: CredentialSource,
  input: CreateChildInput,
  fetchImpl: typeof fetch = fetch,
): Promise<CreateChildResult> {
  try {
    const { response, body } = await fetchAuthenticatedJson<{
      member?: FamilyMember;
      error?: {
        message?: string;
        fieldErrors?: Array<{ field: string; code: string; message: string }>;
      };
    }>(
      FamilyApiRoute.children,
      idToken,
      {
        method: HttpMethod.post,
        headers: {
          [HttpHeader.contentType]: APPLICATION_JSON,
          [HttpHeader.idempotencyKey]: input.idempotencyKey,
        },
        body: JSON.stringify({
          username: input.username,
          displayName: input.displayName,
          color: input.color,
          password: input.password,
        }),
      },
      fetchImpl,
    );
    if (response.ok && body?.member) return { kind: 'success', data: { member: body.member } };
    return {
      kind: 'error',
      message: body?.error?.message ?? messages.familyClient.requestFailed,
      recoverable: response.status !== 401 && response.status < 500,
      ...(body?.error?.fieldErrors ? { fieldErrors: body.error.fieldErrors } : {}),
    };
  } catch {
    return { kind: 'error', message: messages.generic.networkError, recoverable: true };
  }
}
