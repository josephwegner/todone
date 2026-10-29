export { ProfileColor, ProfileColorHex, type ProfileColorId } from '../../shared/profilePalette';

export const HouseholdRole = {
  parent: 'parent',
  child: 'child',
} as const;

export const MembershipActivationState = {
  active: 'ACTIVE',
  pendingActivation: 'PENDING_ACTIVATION',
  inactive: 'INACTIVE',
} as const;

export const MembershipResolutionKind = {
  unattached: 'unattached',
  active: 'active',
  pendingActivation: 'pending-activation',
  inactive: 'inactive',
  credentialsStale: 'credentials-stale',
  inconsistent: 'inconsistent',
} as const;

export const MembershipField = {
  householdId: 'householdId',
  memberId: 'memberId',
  sub: 'sub',
  username: 'username',
  role: 'role',
  activationState: 'activationState',
  credentialsValidAfter: 'credentialsValidAfter',
  createdAt: 'createdAt',
} as const;

export const USERNAME_PATTERN = /^[a-z0-9_-]{3,24}$/;
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;

export const HouseholdRecord = {
  household: 'HOUSEHOLD',
  membership: 'MEMBERSHIP',
  memberPrefix: 'MEMBER',
  userPrefix: 'USER',
  householdPrefix: 'HOUSEHOLD',
  idempotencyPrefix: 'IDEMPOTENCY#HOUSEHOLD',
} as const;

export const HouseholdField = {
  name: 'name',
  timezone: 'timezone',
  username: 'username',
  displayName: 'displayName',
  color: 'color',
  password: 'password',
} as const;

export const HouseholdErrorCode = {
  invalidRequest: 'INVALID_REQUEST',
  invalidName: 'INVALID_NAME',
  invalidTimezone: 'INVALID_TIMEZONE',
  invalidIdempotencyKey: 'INVALID_IDEMPOTENCY_KEY',
  invalidUsername: 'INVALID_USERNAME',
  usernameConflict: 'USERNAME_CONFLICT',
  invalidDisplayName: 'INVALID_DISPLAY_NAME',
  invalidProfileColor: 'INVALID_PROFILE_COLOR',
  profileConflict: 'PROFILE_CONFLICT',
  membershipExists: 'MEMBERSHIP_EXISTS',
  idempotencyConflict: 'IDEMPOTENCY_CONFLICT',
  memberAccessUnavailable: 'MEMBER_ACCESS_UNAVAILABLE',
  sessionReauthenticationRequired: 'SESSION_REAUTHENTICATION_REQUIRED',
  internalError: 'INTERNAL_ERROR',
  targetNotFound: 'TARGET_NOT_FOUND',
  targetNotManageable: 'TARGET_NOT_MANAGEABLE',
  invalidPassword: 'INVALID_PASSWORD',
  passwordResetUnavailable: 'PASSWORD_RESET_UNAVAILABLE',
} as const;

export const MAX_HOUSEHOLD_NAME_LENGTH = 80;
export const MAX_DISPLAY_NAME_LENGTH = 60;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;
/** Reserved for optimistic concurrency checks when household updates are added. */
export const INITIAL_HOUSEHOLD_VERSION = 1;
export const INITIAL_PROFILE_VERSION = 1;
export const ATTRIBUTE_DOES_NOT_EXIST = 'attribute_not_exists(pk)';
