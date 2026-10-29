/** External contract for the verified caller's current-membership endpoint. */
export const CurrentMembershipApi = {
  path: '/api/v1/memberships/current',
  pendingActivation: 'MEMBERSHIP_PENDING_ACTIVATION',
  inactive: 'MEMBERSHIP_INACTIVE',
  inconsistent: 'MEMBERSHIP_INCONSISTENT',
  credentialsStale: 'SESSION_REAUTHENTICATION_REQUIRED',
} as const;

export const SessionApiFailureCode = {
  unauthorized: 'UNAUTHORIZED',
  accessUnavailable: 'MEMBER_ACCESS_UNAVAILABLE',
} as const;

export type MembershipFailure =
  'pending-activation' | 'inactive' | 'inconsistent' | 'credentials-stale';

/** Unknown errors and mismatched statuses never establish membership state. */
export function currentMembershipFailure(status: number, code: unknown): MembershipFailure | null {
  if (status === 403 && code === CurrentMembershipApi.pendingActivation)
    return 'pending-activation';
  if (status === 403 && code === CurrentMembershipApi.inactive) return 'inactive';
  if (status === 500 && code === CurrentMembershipApi.inconsistent) return 'inconsistent';
  if (status === 401 && code === CurrentMembershipApi.credentialsStale) return 'credentials-stale';
  return null;
}

/** Stable household-bootstrap response copy shared by initial and completed-request paths. */
export const MembershipApiMessage = {
  membershipExists: 'A household membership already exists for this account.',
} as const;
