import type { CredentialSource } from './apiClient';
import { ProfileColor, ProfileColorHex, type ProfileColorId } from '../../shared/profilePalette';
import { messages } from '../i18n/messages';
import { APPLICATION_JSON, fetchAuthenticatedJson, HttpHeader, HttpMethod } from './apiClient';

export { ProfileColor, ProfileColorHex, type ProfileColorId };

export interface Profile {
  memberId: string;
  displayName: string;
  color: ProfileColorId;
  version: number;
}

export type ProfileResult =
  | { kind: 'success'; data: { profile: Profile | null } }
  | {
      kind: 'error';
      message: string;
      recoverable: boolean;
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
      error?: {
        message?: string;
        fieldErrors?: Array<{ field: 'displayName' | 'color' | 'version'; message: string }>;
      };
    }>(url, idToken, init, fetchImpl);
    if (response.ok && body && 'profile' in body) {
      return { kind: 'success', data: { profile: body.profile ?? null } };
    }
    return {
      kind: 'error',
      message:
        response.status === 401
          ? messages.profileClient.sessionEnded
          : (body?.error?.message ?? messages.profileClient.requestFailed),
      recoverable: response.status !== 401,
      fieldErrors: body?.error?.fieldErrors,
    };
  } catch {
    return { kind: 'error', message: messages.generic.networkError, recoverable: true };
  }
}
