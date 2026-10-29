import { describe, expect, it } from 'vitest';
import {
  Capability,
  capabilityKeys,
  capabilityRegistry,
  serializeCapabilities,
} from '../../../shared/authorizationCapabilities';
import {
  allowedActions,
  decide,
  principalCapabilities,
  principalFromResolution,
  resolvePrincipal,
  type Principal,
  type PolicyContext,
} from '../../../lambdas/authorization/policy';
import type { HouseholdRepository } from '../../../lambdas/households/model';
const parent: Principal = {
  kind: 'active-parent',
  sub: 'caller',
  memberId: 'self',
  householdId: 'home',
};
const child: Principal = { ...parent, kind: 'active-child' };
const denied: Principal[] = [
  { kind: 'anonymous' },
  ...(
    ['unattached', 'pending-activation', 'inactive', 'inconsistent', 'credentials-stale'] as const
  ).map((kind) => ({ kind, sub: 'caller' })),
];
const contexts: Record<string, PolicyContext> = {
  self: { kind: 'self', householdId: 'home', memberId: 'self' },
  member: {
    kind: 'member',
    householdId: 'home',
    memberId: 'target',
    role: 'child',
    activationState: 'ACTIVE',
  },
  activation: { kind: 'activation', sub: 'caller', proofVerified: true, bindingCurrent: true },
  receipt: {
    kind: 'receipt',
    callerSub: 'caller',
    operation: Capability.childRemove,
    completed: true,
    requestMatched: true,
  },
};
const childAllowed = [
  Capability.householdRead,
  Capability.profileSelfRead,
  Capability.profileSelfUpdate,
  Capability.profileRead,
  Capability.profileUpdate,
  Capability.directoryRead,
  Capability.memberRead,
];
const parentAllowed = [
  ...childAllowed,
  Capability.childCreate,
  Capability.parentCreate,
  Capability.childManage,
  Capability.childPasswordReset,
  Capability.childRemove,
  Capability.parentSelfActivate,
  Capability.recoveryEmailSelfManage,
  Capability.recoveryEmailManage,
  Capability.completedReplay,
];
describe('central capability registry and policy', () => {
  it('has unique keys and deterministic forward-compatible serialization', () => {
    expect(new Set(capabilityKeys).size).toBe(capabilityKeys.length);
    expect(Object.keys(capabilityRegistry).sort()).toEqual([...capabilityKeys].sort());
    expect(serializeCapabilities(['future.unknown', ...capabilityKeys, ...capabilityKeys])).toEqual(
      [...capabilityKeys].sort(),
    );
  });
  for (const principal of [...denied, child, parent]) {
    it.each(capabilityKeys)(`${principal.kind}: explicit decision for %s`, (key) => {
      const context = contexts[capabilityRegistry[key]];
      let expected = false;
      if (principal.kind === 'unattached') expected = key === Capability.householdBootstrap;
      if (principal.kind === 'pending-activation') expected = key === Capability.parentSelfActivate;
      if (principal.kind === 'active-parent') expected = parentAllowed.includes(key);
      if (principal.kind === 'active-child') expected = childAllowed.includes(key as never);
      expect(decide(principal, key, context).allowed).toBe(expected);
      expect(decide(principal, key, context)).toEqual(decide(principal, key, context));
      if (capabilityRegistry[key] !== 'principal')
        expect(decide(principal, key).allowed).toBe(false);
    });
  }
  it.each(capabilityKeys)(
    'denies unknown/cross-household/missing/forged contexts for %s',
    (key) => {
      expect(decide(parent, 'unknown.key').allowed).toBe(false);
      if (capabilityRegistry[key] === 'principal') return;
      expect(
        decide(parent, key, {
          kind: 'member',
          householdId: 'foreign',
          memberId: 'self',
          role: 'child',
          activationState: 'ACTIVE',
        }).allowed,
      ).toBe(false);
      expect(
        decide(parent, key, { kind: 'self', householdId: 'home', memberId: 'peer' }).allowed,
      ).toBe(false);
    },
  );
  it.each(['parent', 'child'] as const)('limits target lifecycle and role for %s', (role) => {
    for (const activationState of ['ACTIVE', 'INACTIVE', 'PENDING_ACTIVATION'] as const) {
      const context = {
        kind: 'member',
        householdId: 'home',
        memberId: 'target',
        role,
        activationState,
      } as const;
      for (const key of [Capability.childRemove, Capability.childPasswordReset])
        expect(decide(parent, key, context).allowed).toBe(
          role === 'child' && activationState === 'ACTIVE',
        );
      for (const key of [
        Capability.pendingParentResend,
        Capability.pendingParentEmail,
        Capability.pendingParentCancel,
      ])
        expect(decide(parent, key, context).allowed).toBe(
          role === 'parent' && activationState === 'PENDING_ACTIVATION',
        );
      expect(decide(child, Capability.memberRead, context).allowed).toBe(
        activationState === 'ACTIVE',
      );
    }
  });
  it('requires complete activation proof and matching completed receipts', () => {
    const receipt = contexts.receipt as Extract<PolicyContext, { kind: 'receipt' }>;
    for (const change of [
      { callerSub: 'foreign' },
      { completed: false },
      { requestMatched: false },
      { operation: Capability.profileUpdate },
    ])
      expect(decide(parent, Capability.completedReplay, { ...receipt, ...change }).allowed).toBe(
        false,
      );
    const activation = contexts.activation as Extract<PolicyContext, { kind: 'activation' }>;
    for (const change of [{ sub: 'peer' }, { proofVerified: false }, { bindingCurrent: false }])
      expect(
        decide(parent, Capability.parentSelfActivate, { ...activation, ...change }).allowed,
      ).toBe(false);
    expect(principalCapabilities(parent)).toEqual([...principalCapabilities(parent)].sort());
    expect(allowedActions(parent, contexts.member!)).toEqual(
      [Capability.childPasswordReset, Capability.childRemove, Capability.memberRead].sort(),
    );
  });
  it('uses verified identity and passes credential cutoff claims to the real resolution boundary', async () => {
    const identity = { sub: 'caller', username: 'caller', issuedAt: 42 };
    const calls: unknown[][] = [];
    const repository = {
      async resolveMembership(...args: unknown[]) {
        calls.push(args);
        return { kind: 'credentials-stale' as const };
      },
    } as unknown as HouseholdRepository;
    expect(await resolvePrincipal(repository, identity)).toEqual({
      kind: 'credentials-stale',
      sub: 'caller',
    });
    expect(calls).toEqual([['caller', 42]]);
    expect(await resolvePrincipal(repository, null)).toEqual({ kind: 'anonymous' });
    expect(calls).toHaveLength(1);
    for (const kind of [
      'unattached',
      'pending-activation',
      'inactive',
      'inconsistent',
      'credentials-stale',
    ] as const)
      expect(principalFromResolution(identity, { kind })).toEqual({ kind, sub: 'caller' });
    for (const role of ['parent', 'child'] as const)
      expect(
        principalFromResolution(identity, {
          kind: 'active',
          membership: {
            memberId: 'member',
            username: 'caller',
            role,
            household: { householdId: 'home', name: 'Home', timezone: 'UTC' },
          },
        }),
      ).toEqual({ kind: `active-${role}`, sub: 'caller', memberId: 'member', householdId: 'home' });
  });
});
