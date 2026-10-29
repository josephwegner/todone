import { describe, expect, it } from 'vitest';
import { resolveMembershipRecords } from '../../../lambdas/households/repository';
import type { Household, Membership, MembershipLookup } from '../../../lambdas/households/model';

const issuedAt = 1800000000;
const createdAt = '2026-08-23T00:00:00.000Z';

function records(overrides?: {
  lookup?: Partial<MembershipLookup>;
  household?: Partial<Household>;
  membership?: Partial<Membership>;
}) {
  const household: Household = {
    householdId: 'house-one',
    name: 'River House',
    timezone: 'America/Chicago',
    createdAt,
    version: 1,
    ...overrides?.household,
  };
  const lookup: MembershipLookup = {
    householdId: household.householdId,
    memberId: 'member-one',
    username: 'parent-one',
    role: 'parent',
    activationState: 'ACTIVE',
    createdAt,
    ...overrides?.lookup,
  };
  const membership: Membership = {
    householdId: household.householdId,
    memberId: lookup.memberId,
    sub: 'sub-one',
    username: lookup.username,
    role: lookup.role,
    activationState: lookup.activationState,
    createdAt,
    ...overrides?.membership,
  };
  return { lookup, household, membership };
}

function resolveRecords(input = records(), tokenIssuedAt: number | undefined = issuedAt) {
  return resolveMembershipRecords(
    input.lookup,
    input.membership,
    input.household,
    'sub-one',
    tokenIssuedAt,
  );
}

describe('active Membership resolution', () => {
  it('returns active only when lookup, Household, and Membership agree', () => {
    expect(resolveRecords()).toMatchObject({
      kind: 'active',
      membership: { memberId: 'member-one', username: 'parent-one', role: 'parent' },
    });
  });

  it('accepts the known first-parent lookup shape without createdAt metadata', () => {
    expect(resolveRecords(records({ lookup: { createdAt: undefined } }))).toMatchObject({
      kind: 'active',
    });
  });

  it.each([
    ['member ID', records({ membership: { memberId: 'other-member' } })],
    ['sub', records({ membership: { sub: 'other-sub' } })],
    ['username', records({ membership: { username: 'other-user' } })],
    ['role', records({ membership: { role: 'child' } })],
    ['activation state', records({ membership: { activationState: 'INACTIVE' } })],
    ['household ID', records({ lookup: { householdId: 'other-house' } })],
  ])('fails closed for a mismatched %s', (_name, input) => {
    expect(resolveRecords(input)).toEqual({
      kind: 'inconsistent',
    });
  });

  it.each([
    [
      'pending',
      records({ lookup: { activationState: 'PENDING_ACTIVATION' } }),
      'pending-activation',
    ],
    ['inactive', records({ lookup: { activationState: 'INACTIVE' } }), 'inactive'],
  ])('returns %s without household authority', (_name, input, kind) => {
    expect(resolveRecords(input)).toEqual({
      kind,
    });
  });

  it('enforces the lookup-owned cutoff for an otherwise active Membership', () => {
    const cutoff = '2028-01-01T00:00:00.000Z';
    const input = records({ lookup: { credentialsValidAfter: cutoff } });
    expect(resolveRecords(input)).toEqual({
      kind: 'credentials-stale',
    });
    expect(resolveRecords(input, undefined)).toEqual({
      kind: 'credentials-stale',
    });
  });
});

it('rejects stale pending-self credentials before activation eligibility', () => {
  const input = records({
    lookup: {
      activationState: 'PENDING_ACTIVATION',
      credentialsValidAfter: '2028-01-01T00:00:00.000Z',
    },
  });
  expect(resolveRecords(input)).toEqual({ kind: 'credentials-stale' });
});
