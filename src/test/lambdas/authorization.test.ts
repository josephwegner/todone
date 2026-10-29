import { describe, expect, it } from 'vitest';
import { Capability } from '../../../shared/authorizationCapabilities';
import {
  decide,
  principalFromMembership,
  resolvePrincipal,
} from '../../../lambdas/authorization/policy';
import { memberContext } from '../../../lambdas/authorization/enforcement';
import { MembershipRecordRepository } from '../helpers/membershipRecordRepository';
import type {
  CurrentMembership,
  FamilyDirectoryMember,
  Household,
  Membership,
  MembershipLookup,
} from '../../../lambdas/households/model';

const parent: CurrentMembership = {
  memberId: 'parent',
  username: 'parent',
  role: 'parent',
  household: { householdId: 'house', name: 'House', timezone: 'America/Chicago' },
};

const child: CurrentMembership = { ...parent, memberId: 'child', role: 'child' };

function member(overrides: Partial<FamilyDirectoryMember>): FamilyDirectoryMember {
  return {
    memberId: 'target',
    username: 'target',
    role: 'child',
    activationState: 'ACTIVE',
    displayName: 'Target',
    color: 'PINE',
    ...overrides,
  };
}

function targetAllowed(
  caller: CurrentMembership,
  target: FamilyDirectoryMember,
  householdId: string,
) {
  return decide(
    principalFromMembership(caller),
    Capability.childPasswordReset,
    memberContext(householdId, target),
  ).allowed;
}

describe('parent target authorization', () => {
  it('allows only an active child target in the caller household context', () => {
    expect(targetAllowed(parent, member({}), 'house')).toBe(true);
    expect(targetAllowed(parent, member({ role: 'parent' }), 'house')).toBe(false);
    expect(targetAllowed(parent, member({ activationState: 'PENDING_ACTIVATION' }), 'house')).toBe(
      false,
    );
    expect(targetAllowed(parent, member({ activationState: 'INACTIVE' }), 'house')).toBe(false);
    expect(targetAllowed(parent, member({}), 'other-house')).toBe(false);
    expect(targetAllowed(child, member({}), 'house')).toBe(false);
  });

  it.each(['PENDING_ACTIVATION', 'INACTIVE'] as const)(
    'rejects a %s caller before target authorization',
    async (activationState) => {
      const household: Household = {
        householdId: 'house',
        name: 'House',
        timezone: 'America/Chicago',
        createdAt: '2026-08-23T00:00:00.000Z',
        version: 1,
      };
      const lookup: MembershipLookup = {
        householdId: household.householdId,
        memberId: 'parent',
        username: 'parent',
        role: 'parent',
        activationState,
        createdAt: household.createdAt,
      };
      const membership: Membership = {
        householdId: household.householdId,
        memberId: lookup.memberId,
        sub: 'parent-sub',
        username: lookup.username,
        role: lookup.role,
        activationState,
        createdAt: household.createdAt,
      };
      const repository = new MembershipRecordRepository('parent-sub', {
        lookup,
        household,
        membership,
      });

      const principal = await resolvePrincipal(repository, {
        sub: 'parent-sub',
        username: 'parent',
        issuedAt: 1800000000,
      });
      expect(decide(principal, Capability.childManage).allowed).toBe(false);
    },
  );
});
