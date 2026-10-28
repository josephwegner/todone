import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { handler as createHousehold } from '../../../lambdas/households/create';
import { handler as currentMembership } from '../../../lambdas/households/current';
import { handler as familyDirectory } from '../../../lambdas/households/directory';
import { readHandler as readProfile } from '../../../lambdas/households/profile';
import { isResourceInHousehold } from '../../../lambdas/households/authorization';
import { InMemoryHouseholdRepository } from '../../../lambdas/households/repository';
import { MembershipRecordRepository } from '../helpers/membershipRecordRepository';
import type {
  CurrentMembership,
  Household,
  Membership,
  MembershipLookup,
} from '../../../lambdas/households/model';

function event(method: 'GET' | 'POST', sub = 'sub-one', body?: unknown, key = 'request-one') {
  return {
    version: '2.0',
    routeKey: `${method} /api/v1/households`,
    rawPath: '/api/v1/households',
    rawQueryString: '',
    headers: key ? { 'idempotency-key': key } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      requestId: 'safe-request-id',
      http: { method, path: '/', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      authorizer: {
        jwt: {
          claims: { token_use: 'id', sub, 'cognito:username': 'parent', iat: '1800000000' },
          scopes: [],
        },
      },
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

async function activeMembership(
  repository: InMemoryHouseholdRepository,
  sub: string,
): Promise<CurrentMembership> {
  const resolution = await repository.resolveMembership(sub, 1800000000);
  if (resolution.kind !== 'active')
    throw new Error(`Expected active membership, received ${resolution.kind}.`);
  return resolution.membership;
}

function membershipRecords(overrides?: {
  lookup?: Partial<MembershipLookup>;
  household?: Partial<Household>;
  membership?: Partial<Membership>;
}) {
  const household: Household = {
    householdId: 'house-one',
    name: 'River House',
    timezone: 'America/Chicago',
    createdAt: '2026-08-23T00:00:00.000Z',
    version: 1,
    ...overrides?.household,
  };
  const lookup: MembershipLookup = {
    householdId: household.householdId,
    memberId: 'member-one',
    username: 'parent-one',
    role: 'parent',
    activationState: 'ACTIVE',
    createdAt: '2026-08-23T00:00:00.000Z',
    ...overrides?.lookup,
  };
  const membership: Membership = {
    householdId: household.householdId,
    memberId: lookup.memberId,
    sub: 'sub-one',
    username: lookup.username,
    role: lookup.role,
    activationState: lookup.activationState,
    createdAt: '2026-08-23T00:00:00.000Z',
    ...overrides?.membership,
  };
  return { lookup, household, membership };
}

describe('household bootstrap API and persistence', () => {
  it('returns null for an authenticated unattached account', async () => {
    const repository = new InMemoryHouseholdRepository();
    const response = await currentMembership(event('GET'), { repository });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? '{}')).toEqual({ membership: null });
  });

  it('atomically creates the household and immutable parent membership', async () => {
    const repository = new InMemoryHouseholdRepository(() => 'generated-id');
    const response = await createHousehold(
      event('POST', 'sub-one', { name: ' River House ', timezone: 'America/Chicago' }),
      { repository },
    );
    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body ?? '{}').membership).toEqual({
      memberId: 'generated-id',
      username: 'parent',
      role: 'parent',
      household: { householdId: 'generated-id', name: 'River House', timezone: 'America/Chicago' },
    });
    expect((await activeMembership(repository, 'sub-one')).role).toBe('parent');
  });

  it('replays the same idempotent request but rejects changed input and a second bootstrap', async () => {
    const repository = new InMemoryHouseholdRepository();
    const firstEvent = event('POST', 'sub-one', {
      name: 'River House',
      timezone: 'America/Chicago',
    });
    const first = await createHousehold(firstEvent, { repository });
    const replay = await createHousehold(firstEvent, { repository });
    const changed = await createHousehold(
      event('POST', 'sub-one', { name: 'Other House', timezone: 'America/Chicago' }),
      { repository },
    );
    const second = await createHousehold(
      event('POST', 'sub-one', { name: 'River House', timezone: 'America/Chicago' }, 'request-two'),
      { repository },
    );
    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toBe(first.body);
    expect(changed.statusCode).toBe(409);
    expect(second.statusCode).toBe(409);
  });

  it('allows different unattached users to create separate households under concurrent calls', async () => {
    let nextId = 0;
    const repository = new InMemoryHouseholdRepository(() => `id-${++nextId}`);
    const body = { name: 'River House', timezone: 'America/Chicago' };
    const [one, two] = await Promise.all([
      createHousehold(event('POST', 'sub-one', body, 'one'), { repository }),
      createHousehold(event('POST', 'sub-two', body, 'two'), { repository }),
    ]);
    expect(one.statusCode).toBe(201);
    expect(two.statusCode).toBe(201);
    expect((await activeMembership(repository, 'sub-one')).household.householdId).not.toBe(
      (await activeMembership(repository, 'sub-two')).household.householdId,
    );
  });

  it('rejects invalid fields and public join/role attempts without a write', async () => {
    const repository = new InMemoryHouseholdRepository();
    const response = await createHousehold(
      event('POST', 'sub-one', {
        name: '',
        timezone: 'invalid',
        householdId: 'target',
        role: 'parent',
      }),
      { repository },
    );
    expect(response.statusCode).toBe(422);
    expect((await repository.resolveMembership('sub-one')).kind).toBe('unattached');
    expect(response.body).not.toContain('target');
  });

  it('denies missing authentication before touching membership data', async () => {
    const repository = new InMemoryHouseholdRepository();
    const unauthenticated = event('GET');
    delete (unauthenticated.requestContext as { authorizer?: unknown }).authorizer;
    const response = await currentMembership(unauthenticated, {
      repository,
      verifier: {
        verify: async () => {
          throw new Error('invalid');
        },
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not let a valid member authorize a resource from another household', async () => {
    const repository = new InMemoryHouseholdRepository();
    await repository.bootstrap({
      sub: 'sub-one',
      username: 'parent',
      idempotencyKey: 'one',
      name: 'One',
      timezone: 'America/Chicago',
    });
    const membership = await activeMembership(repository, 'sub-one');
    expect(isResourceInHousehold(membership, membership.household.householdId)).toBe(true);
    expect(isResourceInHousehold(membership, 'another-household')).toBe(false);
  });

  it('creates and version-updates a member profile without accepting stale writes', async () => {
    const repository = new InMemoryHouseholdRepository(() => 'generated-id');
    await expect(repository.getProfile('missing-household', 'missing-member')).resolves.toBeNull();
    const bootstrap = await repository.bootstrap({
      sub: 'sub-one',
      username: 'parent',
      idempotencyKey: 'one',
      name: 'River House',
      timezone: 'America/Chicago',
    });
    if (bootstrap.kind !== 'created') throw new Error('Expected a new membership.');

    const create = await repository.saveProfile({
      householdId: bootstrap.membership.household.householdId,
      memberId: bootstrap.membership.memberId,
      displayName: 'Parent One',
      color: 'PINE',
      version: 0,
    });
    expect(create).toMatchObject({ kind: 'created', profile: { version: 1 } });

    const update = await repository.saveProfile({
      householdId: bootstrap.membership.household.householdId,
      memberId: bootstrap.membership.memberId,
      displayName: 'Parent Uno',
      color: 'LAKE',
      version: 1,
    });
    expect(update).toMatchObject({ kind: 'updated', profile: { version: 2 } });

    const stale = await repository.saveProfile({
      householdId: bootstrap.membership.household.householdId,
      memberId: bootstrap.membership.memberId,
      displayName: 'Stale',
      color: 'DUSK',
      version: 1,
    });
    expect(stale).toMatchObject({ kind: 'conflict', profile: { version: 2 } });

    const skipped = await repository.saveProfile({
      householdId: bootstrap.membership.household.householdId,
      memberId: bootstrap.membership.memberId,
      displayName: 'Skipped',
      color: 'DUSK',
      version: 3,
    });
    expect(skipped).toMatchObject({ kind: 'conflict', profile: { version: 2 } });
  });

  it('returns only safe, deterministic family-directory fields for the caller household', async () => {
    const repository = new InMemoryHouseholdRepository(() => 'generated-id');
    await repository.bootstrap({
      sub: 'sub-one',
      username: 'parent-one',
      idempotencyKey: 'one',
      name: 'River House',
      timezone: 'America/Chicago',
    });
    const membership = await activeMembership(repository, 'sub-one');
    await repository.saveProfile({
      householdId: membership.household.householdId,
      memberId: membership.memberId,
      displayName: 'Parent One',
      color: 'PINE',
      version: 0,
    });

    const response = await familyDirectory(event('GET'), { repository });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? '{}')).toEqual({
      members: [
        {
          memberId: 'generated-id',
          username: 'parent-one',
          role: 'parent',
          activationState: 'ACTIVE',
          displayName: 'Parent One',
          color: 'PINE',
          allowedActions: [],
        },
      ],
    });
    expect(response.body).not.toContain('sub-one');
  });

  it.each([
    [
      'pending',
      membershipRecords({ lookup: { activationState: 'PENDING_ACTIVATION' } }),
      403,
      'MEMBERSHIP_PENDING_ACTIVATION',
    ],
    [
      'inactive',
      membershipRecords({ lookup: { activationState: 'INACTIVE' } }),
      403,
      'MEMBERSHIP_INACTIVE',
    ],
    [
      'credential-stale',
      membershipRecords({ lookup: { credentialsValidAfter: '2028-01-01T00:00:00.000Z' } }),
      401,
      'SESSION_REAUTHENTICATION_REQUIRED',
    ],
    [
      'inconsistent',
      membershipRecords({ membership: { role: 'child' } }),
      500,
      'MEMBERSHIP_INCONSISTENT',
    ],
  ])(
    'does not treat a %s Membership as an unattached account',
    async (_state, records, statusCode, code) => {
      const repository = new MembershipRecordRepository('sub-one', records);

      const response = await currentMembership(event('GET'), { repository });
      expect(response.statusCode).toBe(statusCode);
      expect(response.headers?.['cache-control']).toBe('no-store');
      const body = JSON.parse(response.body ?? '{}');
      expect(Object.keys(body)).toEqual(['error']);
      expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'requestId']);
      expect(body.error.code).toBe(code);
      expect(body.error.requestId).toBe('safe-request-id');
      for (const value of ['house-one', 'member-one', 'parent-one', 'sub-one']) {
        expect(response.body).not.toContain(value);
      }
      expect(response.body).not.toContain('River House');
      expect(response.body).not.toContain('membership":null');
    },
  );

  it('denies non-active Membership before profile data reads', async () => {
    const repository = new MembershipRecordRepository(
      'sub-one',
      membershipRecords({ lookup: { activationState: 'PENDING_ACTIVATION' } }),
    );

    const response = await readProfile(event('GET'), { repository });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body ?? '{}').error.code).toBe('MEMBER_ACCESS_UNAVAILABLE');
    expect(response.body).not.toContain('profile');
  });
});
