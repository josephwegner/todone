import type { CapabilityKey } from '../../shared/authorizationCapabilities';
import type { ChildRemovalRepository } from './childRemoval';
import type { PendingParentRepository } from './pendingParents';
import { MembershipResolutionKind, type ProfileColorId } from './constants';

export type MembershipRole = 'parent' | 'child';
export type MembershipActivationState = 'ACTIVE' | 'PENDING_ACTIVATION' | 'INACTIVE';

export interface Household {
  householdId: string;
  name: string;
  timezone: string;
  createdAt: string;
  /** Starts at 1 and is reserved for optimistic concurrency on future updates. */
  version: number;
}

export interface Membership {
  memberId: string;
  householdId: string;
  sub: string;
  username: string;
  role: MembershipRole;
  activationState: MembershipActivationState;
  createdAt: string;
}

export interface MembershipLookup {
  householdId: string;
  memberId: string;
  username: string;
  role: MembershipRole;
  activationState: MembershipActivationState;
  credentialsValidAfter?: string;
  /** Optional only for first-parent lookups written before family-account metadata existed. */
  createdAt?: string;
}

export interface CurrentMembership {
  memberId: string;
  username: string;
  role: MembershipRole;
  household: Pick<Household, 'householdId' | 'name' | 'timezone'>;
}

/** A fail-closed result for the verified caller's lookup, Household, and Membership records. */
export type MembershipResolution =
  | { kind: (typeof MembershipResolutionKind)['unattached'] }
  | { kind: (typeof MembershipResolutionKind)['active']; membership: CurrentMembership }
  | { kind: (typeof MembershipResolutionKind)['pendingActivation'] }
  | { kind: (typeof MembershipResolutionKind)['inactive'] }
  | { kind: (typeof MembershipResolutionKind)['credentialsStale'] }
  | { kind: (typeof MembershipResolutionKind)['inconsistent'] };

export interface Profile {
  memberId: string;
  displayName: string;
  color: ProfileColorId;
  version: number;
}

/** Safe family-directory representation; recovery contact and Cognito fields never belong here. */
export interface FamilyDirectoryMember {
  memberId: string;
  username: string;
  role: MembershipRole;
  activationState: MembershipActivationState;
  displayName?: string;
  color?: ProfileColorId;
}

export interface FamilyDirectoryEntry extends FamilyDirectoryMember {
  allowedActions: CapabilityKey[];
}

export interface SaveProfileInput {
  householdId: string;
  memberId: string;
  displayName: string;
  color: ProfileColorId;
  version: number;
}

export interface ProvisionChildInput {
  callerSub: string;
  householdId: string;
  childSub: string;
  username: string;
  displayName: string;
  color: ProfileColorId;
  idempotencyKey: string;
}

/** Internal target record; it is never returned from a family-directory API. */
export interface HouseholdMemberTarget {
  memberId: string;
  sub: string;
  username: string;
  role: MembershipRole;
  activationState: MembershipActivationState;
}

export type ProvisionChildResult =
  | { kind: 'created' | 'replayed'; member: FamilyDirectoryMember }
  | { kind: 'idempotency-conflict' };

export type SaveProfileResult =
  { kind: 'created' | 'updated'; profile: Profile } | { kind: 'conflict'; profile: Profile | null };

export interface BootstrapInput {
  sub: string;
  username: string;
  idempotencyKey: string;
  name: string;
  timezone: string;
}

export type BootstrapResult =
  | { kind: 'created' | 'replayed'; membership: CurrentMembership }
  | { kind: 'already-member' }
  | { kind: 'idempotency-conflict' };

export interface HouseholdRepository {
  readonly childRemoval: ChildRemovalRepository;
  readonly pendingParents: PendingParentRepository;
  resolveMembership(sub: string, tokenIssuedAt?: number): Promise<MembershipResolution>;
  findBootstrapReplay(input: BootstrapInput): Promise<BootstrapResult | null>;
  bootstrap(input: BootstrapInput): Promise<BootstrapResult>;
  getProfile(householdId: string, memberId: string): Promise<Profile | null>;
  saveProfile(input: SaveProfileInput): Promise<SaveProfileResult>;
  listFamilyMembers(householdId: string): Promise<FamilyDirectoryMember[]>;
  getHouseholdMemberTarget(
    householdId: string,
    memberId: string,
  ): Promise<HouseholdMemberTarget | null>;
  /** Advances the one canonical identity-session cutoff without ever moving it backwards. */
  advanceCredentialsValidAfter(sub: string, cutoff: string): Promise<void>;
  /** Checks a completed child-provisioning request before any Cognito side effect. */
  findChildProvisionReplay(
    input: Omit<ProvisionChildInput, 'childSub'>,
  ): Promise<ProvisionChildResult | null>;
  provisionChild(input: ProvisionChildInput): Promise<ProvisionChildResult>;
}
