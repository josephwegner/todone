import { serializeCapabilities, type CapabilityKey } from '../../shared/authorizationCapabilities';
import type { CredentialSource } from './apiClient';
import {
  currentMembershipFailure,
  CurrentMembershipApi,
  type MembershipFailure,
} from '../../shared/membershipContract';
import { APPLICATION_JSON, fetchAuthenticatedJson, HttpHeader, HttpMethod } from './apiClient';

export interface CurrentMembership {
  memberId: string;
  username: string;
  role: 'parent' | 'child';
  capabilities?: readonly CapabilityKey[];
  household: { householdId: string; name: string; timezone: string };
}

export interface MembershipResponse {
  capabilities?: readonly CapabilityKey[];
  membership: CurrentMembership | null;
}

export type HouseholdResult =
  | { kind: 'success'; data: MembershipResponse }
  | {
      kind: 'error';
      message: string;
      recoverable: boolean;
      failure?: MembershipFailure;
      fieldErrors?: Array<{ field: 'name' | 'timezone'; message: string }>;
    };

export async function fetchCurrentMembership(
  idToken: CredentialSource,
  fetchImpl: typeof fetch = fetch,
): Promise<HouseholdResult> {
  return request(CurrentMembershipApi.path, idToken, { method: HttpMethod.get }, fetchImpl);
}

export async function createHousehold(
  idToken: CredentialSource,
  input: { name: string; timezone: string; idempotencyKey: string },
  fetchImpl: typeof fetch = fetch,
): Promise<HouseholdResult> {
  return request(
    HouseholdApiRoute.households,
    idToken,
    {
      method: HttpMethod.post,
      headers: {
        [HttpHeader.contentType]: APPLICATION_JSON,
        [HttpHeader.idempotencyKey]: input.idempotencyKey,
      },
      body: JSON.stringify({ name: input.name, timezone: input.timezone }),
    },
    fetchImpl,
  );
}

async function request(
  url: string,
  idToken: CredentialSource,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<HouseholdResult> {
  try {
    const { response, body } = await fetchAuthenticatedJson<{
      membership?: CurrentMembership | null;
      capabilities?: readonly CapabilityKey[];
      error?: {
        code?: string;
        message?: string;
        fieldErrors?: Array<{ field: 'name' | 'timezone'; message: string }>;
      };
    }>(url, idToken, init, fetchImpl);
    if (response.ok && body && 'membership' in body) {
      const membership = body.membership
        ? {
            ...body.membership,
            capabilities: serializeCapabilities(body.membership.capabilities ?? []),
          }
        : null;
      return {
        kind: 'success',
        data: {
          membership,
          capabilities: serializeCapabilities(body.capabilities ?? membership?.capabilities ?? []),
        },
      };
    }
    const failure =
      url === CurrentMembershipApi.path
        ? currentMembershipFailure(response.status, body?.error?.code)
        : null;
    return {
      kind: 'error',
      message:
        response.status === 401
          ? messages.householdClient.sessionEnded
          : (body?.error?.message ?? messages.householdClient.requestFailed),
      recoverable: response.status !== 401,
      ...(failure ? { failure } : {}),
      fieldErrors: body?.error?.fieldErrors,
    };
  } catch {
    return {
      kind: 'error',
      message: messages.generic.networkError,
      recoverable: true,
    };
  }
}
import { messages } from '../i18n/messages';

const HouseholdApiRoute = {
  households: '/api/v1/households',
} as const;
