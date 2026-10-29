import { serializeCapabilities, type CapabilityKey } from '../../shared/authorizationCapabilities';
import type { CredentialSource } from './apiClient';
import { ProfileColor, ProfileColorHex, type ProfileColorId } from '../../shared/profilePalette';
import { messages } from '../i18n/messages';
import { APPLICATION_JSON, fetchAuthenticatedJson, HttpHeader, HttpMethod } from './apiClient';

export { ProfileColor, ProfileColorHex, type ProfileColorId };

export interface Profile {
  allowedActions?: readonly CapabilityKey[];
  memberId: string;
  displayName: string;
  color: ProfileColorId;
  version: number;
}

export type ProfileResult =
  | {
      kind: 'success';
      data: { profile: Profile | null; allowedActions?: readonly CapabilityKey[] };
    }
  | {
      kind: 'error';
      message: string;
      recoverable: boolean;
      denied?: boolean;
      fieldErrors?: Array<{ field: 'displayName' | 'color' | 'version'; message: string }>;
    };

const ProfileApiRoute = { mine: '/api/v1/profiles/me' } as const;
/** Reads only the authenticated member's profile; the route accepts no target identity. */
export async function fetchMyProfile(
  idToken: CredentialSource,
  fetchImpl: typeof fetch = fetch,
): Promise<ProfileResult> {
  return request(ProfileApiRoute.mine, idToken, { method: HttpMethod.get }, fetchImpl);
}

/** Creates or replaces only the authenticated member's versioned profile. */
export async function saveMyProfile(
  idToken: CredentialSource,
  input: Pick<Profile, 'displayName' | 'color' | 'version'>,
  fetchImpl: typeof fetch = fetch,
): Promise<ProfileResult> {
  return request(
    ProfileApiRoute.mine,
    idToken,
    {
      method: HttpMethod.put,
      headers: { [HttpHeader.contentType]: APPLICATION_JSON },
      body: JSON.stringify(input),
    },
    fetchImpl,
  );
}

async function request(
  url: string,
  idToken: CredentialSource,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<ProfileResult> {
  try {
    const { response, body } = await fetchAuthenticatedJson<{
      profile?: Profile | null;
      allowedActions?: readonly CapabilityKey[];
      error?: {
        message?: string;
        fieldErrors?: Array<{ field: 'displayName' | 'color' | 'version'; message: string }>;
      };
    }>(url, idToken, init, fetchImpl);
    if (response.ok && body && 'profile' in body) {
      const actions = serializeCapabilities(body.allowedActions ?? []);
      const profile = body.profile ? { ...body.profile, allowedActions: actions } : null;
      return { kind: 'success', data: { profile, allowedActions: actions } };
    }
    return {
      kind: 'error',
      message:
        response.status === 401
          ? messages.profileClient.sessionEnded
          : (body?.error?.message ?? messages.profileClient.requestFailed),
      recoverable: response.status !== 401,
      denied: response.status === 403 || response.status === 404,
      fieldErrors: body?.error?.fieldErrors,
    };
  } catch {
    return { kind: 'error', message: messages.generic.networkError, recoverable: true };
  }
}
