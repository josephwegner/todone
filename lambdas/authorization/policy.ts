import {
  Capability,
  capabilityKeys,
  capabilityRegistry,
  isCapabilityKey,
  serializeCapabilities,
  type CapabilityKey,
} from '../../shared/authorizationCapabilities';
import type { AuthenticatedIdentity } from '../shared/auth';
import type {
  CurrentMembership,
  HouseholdRepository,
  MembershipResolution,
  MembershipRole,
  MembershipActivationState,
} from '../households/model';

export type Principal =
  | { kind: 'anonymous' }
  | {
      kind: 'unattached' | 'pending-activation' | 'inactive' | 'credentials-stale' | 'inconsistent';
      sub: string;
    }
  | { kind: 'active-parent' | 'active-child'; sub: string; householdId: string; memberId: string };
export type ActivePrincipal = Extract<Principal, { householdId: string }>;
export type PolicyContext =
  | { kind: 'self'; householdId: string; memberId: string }
  | {
      kind: 'member';
      householdId: string;
      memberId: string;
      role: MembershipRole;
      activationState: MembershipActivationState;
    }
  | { kind: 'activation'; sub: string; proofVerified: boolean; bindingCurrent: boolean }
  | {
      kind: 'receipt';
      callerSub: string;
      operation: CapabilityKey;
      completed: boolean;
      requestMatched: boolean;
    };
export type Decision =
  { allowed: true } | { allowed: false; reason: 'unknown' | 'principal' | 'context' };
const ALLOW = { allowed: true } as const;
const DENY_PRINCIPAL = { allowed: false, reason: 'principal' } as const;
const DENY_CONTEXT = { allowed: false, reason: 'context' } as const;

/** Only server-validated Membership resolution may enter this request-local identity boundary. */
export function principalFromMembership(membership: CurrentMembership, sub = ''): ActivePrincipal {
  let kind: ActivePrincipal['kind'] = 'active-child';
  if (membership.role === 'parent') kind = 'active-parent';
  return {
    kind,
    sub,
    householdId: membership.household.householdId,
    memberId: membership.memberId,
  };
}
export function principalFromResolution(
  identity: AuthenticatedIdentity | null,
  resolution?: MembershipResolution,
): Principal {
  if (!identity) return { kind: 'anonymous' };
  if (!resolution) return { kind: 'inconsistent', sub: identity.sub };
  if (resolution.kind === 'active')
    return principalFromMembership(resolution.membership, identity.sub);
  return { kind: resolution.kind, sub: identity.sub };
}
export async function resolvePrincipal(
  repository: HouseholdRepository,
  identity: AuthenticatedIdentity | null,
): Promise<Principal> {
  if (!identity) return principalFromResolution(null);
  return principalFromResolution(
    identity,
    await repository.resolveMembership(identity.sub, identity.issuedAt),
  );
}
export function isActivePrincipal(principal: Principal): principal is ActivePrincipal {
  return principal.kind === 'active-parent' || principal.kind === 'active-child';
}
const replayOperations: readonly CapabilityKey[] = [
  Capability.householdBootstrap,
  Capability.childCreate,
  Capability.parentCreate,
  Capability.childRemove,
  Capability.pendingParentResend,
  Capability.pendingParentEmail,
  Capability.pendingParentCancel,
];
type Rule = (principal: Principal, context?: PolicyContext) => Decision;
const active: Rule = (p) => {
  if (isActivePrincipal(p)) return ALLOW;
  return DENY_PRINCIPAL;
};
const parent: Rule = (p) => {
  if (p.kind === 'active-parent') return ALLOW;
  return DENY_PRINCIPAL;
};
const self: Rule = (p, c) => {
  if (!isActivePrincipal(p)) return DENY_PRINCIPAL;
  if (
    (c?.kind !== 'self' && c?.kind !== 'member') ||
    (c.kind === 'member' && c.activationState !== 'ACTIVE') ||
    !c.memberId ||
    !c.householdId ||
    c.memberId !== p.memberId ||
    c.householdId !== p.householdId
  )
    return DENY_CONTEXT;
  return ALLOW;
};
const parentSelf: Rule = (p, c) => {
  if (p.kind !== 'active-parent') return DENY_PRINCIPAL;
  return self(p, c);
};
const child: Rule = (p, c) => {
  if (p.kind !== 'active-parent') return DENY_PRINCIPAL;
  if (
    c?.kind !== 'member' ||
    !c.memberId ||
    c.householdId !== p.householdId ||
    c.role !== 'child' ||
    c.activationState !== 'ACTIVE'
  )
    return DENY_CONTEXT;
  return ALLOW;
};
const pending: Rule = (p, c) => {
  if (p.kind !== 'active-parent') return DENY_PRINCIPAL;
  if (
    c?.kind !== 'member' ||
    !c.memberId ||
    c.householdId !== p.householdId ||
    c.role !== 'parent' ||
    c.activationState !== 'PENDING_ACTIVATION'
  )
    return DENY_CONTEXT;
  return ALLOW;
};
/** Exhaustive mapping: adding a key cannot silently inherit another operation's rule. */
const rules = {
  [Capability.householdBootstrap]: (p) => {
    if (p.kind === 'unattached') return ALLOW;
    return DENY_PRINCIPAL;
  },
  [Capability.householdRead]: active,
  [Capability.profileSelfRead]: active,
  [Capability.profileSelfUpdate]: active,
  [Capability.profileRead]: self,
  [Capability.profileUpdate]: self,
  [Capability.directoryRead]: active,
  [Capability.memberRead]: (p, c) => {
    if (!isActivePrincipal(p)) return DENY_PRINCIPAL;
    if (c?.kind !== 'member' || !c.memberId || c.householdId !== p.householdId) return DENY_CONTEXT;
    if (c.activationState === 'ACTIVE' && (c.role === 'child' || c.role === 'parent')) return ALLOW;
    return pending(p, c);
  },
  [Capability.childCreate]: parent,
  [Capability.parentCreate]: parent,
  [Capability.childManage]: parent,
  [Capability.childPasswordReset]: child,
  [Capability.childRemove]: child,
  [Capability.pendingParentResend]: pending,
  [Capability.pendingParentEmail]: pending,
  [Capability.pendingParentCancel]: pending,
  [Capability.recoveryEmailSelfManage]: parent,
  [Capability.recoveryEmailManage]: parentSelf,
  [Capability.parentSelfActivate]: (p, c) => {
    if (p.kind !== 'pending-activation' && p.kind !== 'active-parent') return DENY_PRINCIPAL;
    if (
      c?.kind !== 'activation' ||
      !p.sub ||
      c.sub !== p.sub ||
      c.bindingCurrent !== true ||
      c.proofVerified !== true
    )
      return DENY_CONTEXT;
    return ALLOW;
  },
  [Capability.completedReplay]: (p, c) => {
    if (p.kind !== 'active-parent') return DENY_PRINCIPAL;
    if (
      c?.kind !== 'receipt' ||
      !p.sub ||
      c.callerSub !== p.sub ||
      c.completed !== true ||
      c.requestMatched !== true ||
      !replayOperations.includes(c.operation)
    )
      return DENY_CONTEXT;
    return ALLOW;
  },
} satisfies Record<CapabilityKey, Rule>;

/** Pure policy: callers provide trusted context; no storage, metrics or SDK effects occur here. */
export function decide(principal: Principal, key: unknown, context?: PolicyContext): Decision {
  if (isActivePrincipal(principal) && (!principal.householdId || !principal.memberId))
    return DENY_PRINCIPAL;
  if (!isCapabilityKey(key)) return { allowed: false, reason: 'unknown' };
  return (rules[key] as Rule)(principal, context);
}
export function principalCapabilities(principal: Principal): CapabilityKey[] {
  return serializeCapabilities(
    capabilityKeys.filter(
      (key) => capabilityRegistry[key] === 'principal' && decide(principal, key).allowed,
    ),
  );
}
export function allowedActions(principal: Principal, context: PolicyContext): CapabilityKey[] {
  return serializeCapabilities(
    capabilityKeys.filter(
      (key) => capabilityRegistry[key] !== 'principal' && decide(principal, key, context).allowed,
    ),
  );
}
