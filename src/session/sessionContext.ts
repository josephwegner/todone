import { fetchCurrentMembership } from '../services/householdClient';
import { fetchMyProfile } from '../services/profileClient';
import type { AuthSession } from '../services/authClient';
import type { SessionContextResult } from './sessionController';
import type { CredentialSource } from '../services/apiClient';

/** Resolves presentation context through server authorization, never inferred roles. */
export async function readSessionContext(
  credentials: AuthSession,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  source: CredentialSource = credentials.idToken,
): Promise<SessionContextResult> {
  const abortableFetch: typeof fetch = (input, init) => fetchImpl(input, { ...init, signal });
  const membership = await fetchCurrentMembership(source, abortableFetch);
  if (membership.kind === 'error') {
    return {
      kind: 'error',
      failure:
        membership.failure ?? (membership.recoverable ? 'context-unavailable' : 'session-ended'),
    };
  }
  if (!membership.data.membership)
    return {
      kind: 'success',
      context: { kind: 'unattached', capabilities: membership.data.capabilities ?? [] },
    };
  const profile = await fetchMyProfile(source, abortableFetch);
  if (profile.kind === 'error') {
    return {
      kind: 'error',
      failure: profile.recoverable ? 'context-unavailable' : 'session-ended',
    };
  }
  if (!profile.data.profile)
    return {
      kind: 'success',
      context: {
        kind: 'profile-required',
        membership: membership.data.membership,
        allowedActions: profile.data.allowedActions,
      },
    };
  return {
    kind: 'success',
    context: {
      kind: 'active',
      membership: membership.data.membership,
      profile: profile.data.profile,
    },
  };
}
