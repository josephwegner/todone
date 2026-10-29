import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { Capability } from '../../../shared/authorizationCapabilities';
import { handler as current } from '../../../lambdas/households/current';
import { handler as directory } from '../../../lambdas/households/directory';
import { readHandler, updateHandler } from '../../../lambdas/households/profile';
import { handler as children } from '../../../lambdas/households/children';
import { handler as reset } from '../../../lambdas/households/resetChildPassword';
import { handler as remove } from '../../../lambdas/households/removeChild';
import { handler as recovery } from '../../../lambdas/households/recoveryEmail';
import {
  createParentHandler,
  pendingParentActionHandler,
} from '../../../lambdas/households/parentHandlers';
import { InMemoryHouseholdRepository } from '../../../lambdas/households/repository';
import { MembershipRecordRepository } from '../helpers/membershipRecordRepository';
import type { CognitoAdministration } from '../../../lambdas/cognito/administration';
import {
  principalCapabilities,
  principalFromMembership,
  decide,
} from '../../../lambdas/authorization/policy';
import { memberContext } from '../../../lambdas/authorization/enforcement';
function event(
  body?: unknown,
  method = 'POST',
  memberId = 'target',
  sub = 'caller',
): APIGatewayProxyEventV2 {
  return {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'idempotency-key': 'operation' },
    pathParameters: { memberId },
    requestContext: {
      requestId: 'request',
      http: { method },
      authorizer: {
        jwt: { claims: { token_use: 'id', sub, 'cognito:username': sub, iat: 100 } },
      },
    },
  } as unknown as APIGatewayProxyEventV2;
}
function administration(): CognitoAdministration {
  return {
    createUser: vi.fn(),
    canResendWelcome: vi.fn(),
    setPermanentPassword: vi.fn(),
    globalSignOut: vi.fn(),
    deleteUser: vi.fn(),
    resendWelcome: vi.fn(),
    updatePendingParentEmail: vi.fn(),
    stageRecoveryEmail: vi.fn(),
  };
}
afterEach(() => vi.restoreAllMocks());
describe('capability enforcement at delivered endpoint boundaries', () => {
  for (const state of [
    'PENDING_ACTIVATION',
    'INACTIVE',
    'cutoff',
    'inconsistent',
    'child',
  ] as const) {
    it(`${state} cannot reach administration, target data, writes or completed receipts`, async () => {
      const activationState =
        state === 'PENDING_ACTIVATION' || state === 'INACTIVE' ? state : 'ACTIVE';
      const role = state === 'child' ? 'child' : 'parent';
      const repository = new MembershipRecordRepository('caller', {
        lookup: {
          householdId: 'home',
          memberId: 'self',
          username: 'caller',
          role,
          activationState,
          ...(state === 'cutoff' ? { credentialsValidAfter: '2030-01-01T00:00:00.000Z' } : {}),
        },
        household: {
          householdId: 'home',
          name: 'Home',
          timezone: 'UTC',
          createdAt: '2026-01-01',
          version: 1,
        },
        membership: {
          householdId: 'home',
          memberId: 'self',
          sub: state === 'inconsistent' ? 'foreign' : 'caller',
          username: 'caller',
          role,
          activationState,
          createdAt: '2026-01-01',
        },
      });
      const admin = administration();
      const reads = [
        vi.spyOn(repository, 'getHouseholdMemberTarget'),
        vi.spyOn(repository, 'listFamilyMembers'),
        vi.spyOn(repository.pendingParents, 'context'),
        vi.spyOn(repository.pendingParents, 'replay'),
        vi.spyOn(repository.childRemoval, 'replay'),
      ];
      const writes = [
        vi.spyOn(repository, 'provisionChild'),
        vi.spyOn(repository, 'saveProfile'),
        vi.spyOn(repository.childRemoval, 'begin'),
        vi.spyOn(repository.pendingParents, 'acquire'),
      ];
      const deps = { repository, administration: admin };
      const calls = [
        () =>
          children(
            event({
              username: 'new-child',
              displayName: 'Child',
              color: 'PINE',
              password: 'Private123!',
            }),
            deps,
          ),
        () =>
          createParentHandler(
            event({ username: 'new-parent', email: 'private@example.test' }),
            deps,
          ),
        () => reset(event({ password: 'Private123!' }, 'PUT'), deps),
        () => remove(event({ confirmation: true }, 'DELETE'), deps),
        () => pendingParentActionHandler(event(undefined, 'POST'), deps),
        () => pendingParentActionHandler(event({ email: 'private@example.test' }, 'PUT'), deps),
        () => pendingParentActionHandler(event({ confirmation: true }, 'DELETE'), deps),
        () => recovery(event({ email: 'private@example.test' }, 'PUT'), deps),
      ];
      for (const call of calls) {
        const response = await call();
        expect(response.statusCode).toBe(
          state === 'cutoff' ? 401 : state === 'inconsistent' ? 500 : 403,
        );
        expect(response.body).not.toMatch(/private@example|foreign|home/);
      }
      for (const spy of [...reads, ...writes, ...Object.values(admin)])
        expect(spy).not.toHaveBeenCalled();
    });
  }
  it('returns only policy-approved sorted presentation actions and ignores no request grant', async () => {
    let id = 0;
    const repository = new InMemoryHouseholdRepository(() => `id-${++id}`);
    const created = await repository.bootstrap({
      sub: 'caller',
      username: 'caller',
      idempotencyKey: 'bootstrap',
      name: 'Home',
      timezone: 'UTC',
    });
    if (!('membership' in created)) throw new Error('fixture');
    const membership = created.membership;
    const deps = { repository };
    const response = JSON.parse((await current(event(undefined, 'GET'), deps)).body!);
    expect(response.capabilities).toEqual(
      principalCapabilities(principalFromMembership(membership)),
    );
    expect(response.membership.capabilities).toEqual(response.capabilities);
    const absent = JSON.parse((await readHandler(event(undefined, 'GET'), deps)).body!);
    expect(absent.profile).toBeNull();
    expect(absent.allowedActions).toEqual(
      [Capability.profileRead, Capability.profileUpdate].sort(),
    );
    const overpost = await updateHandler(
      event(
        {
          displayName: 'Caller',
          color: 'PINE',
          version: 0,
          allowedActions: [Capability.profileUpdate],
          capabilities: [Capability.childRemove],
          memberId: 'peer',
        },
        'PUT',
      ),
      deps,
    );
    expect(overpost.statusCode).toBe(422);
    expect(
      await repository.getProfile(membership.household.householdId, membership.memberId),
    ).toBeNull();
    await repository.provisionChild({
      callerSub: 'caller',
      householdId: membership.household.householdId,
      childSub: 'child',
      username: 'child',
      displayName: 'Child',
      color: 'PINE',
      idempotencyKey: 'child',
    });
    const represented = JSON.parse((await directory(event(undefined, 'GET'), deps)).body!).members;
    for (const member of represented) {
      expect(member.allowedActions).toEqual([...new Set(member.allowedActions)].sort());
      for (const key of member.allowedActions)
        expect(
          decide(
            principalFromMembership(membership),
            key,
            memberContext(membership.household.householdId, member),
          ).allowed,
        ).toBe(true);
    }
  });
});

it('completed removal receipts are caller/target bound and never repeat deletion', async () => {
  let id = 0;
  const repository = new InMemoryHouseholdRepository(() => `receipt-${++id}`);
  const bootstrap = await repository.bootstrap({
    sub: 'caller',
    username: 'caller',
    idempotencyKey: 'home',
    name: 'Home',
    timezone: 'UTC',
  });
  if (!('membership' in bootstrap)) throw new Error('fixture');
  const householdId = bootstrap.membership.household.householdId;
  const provision = await repository.provisionChild({
    callerSub: 'caller',
    householdId,
    childSub: 'child',
    username: 'child',
    displayName: 'Child',
    color: 'PINE',
    idempotencyKey: 'child',
  });
  if (!('member' in provision)) throw new Error('fixture');
  const admin = administration();
  const deps = { repository, administration: admin };
  const request = event({ confirmation: true }, 'DELETE', provision.member.memberId);
  expect((await remove(request, deps)).statusCode).toBe(204);
  expect((await remove(request, deps)).statusCode).toBe(204);
  expect(admin.deleteUser).toHaveBeenCalledTimes(1);
  expect(
    (await remove(event({ confirmation: true }, 'DELETE', 'forged-target'), deps)).statusCode,
  ).toBe(409);
  const absentReceipt = { ...request, headers: { 'idempotency-key': 'never-completed' } };
  expect((await remove(absentReceipt, deps)).statusCode).toBe(404);
  await repository.bootstrap({
    sub: 'foreign',
    username: 'foreign',
    idempotencyKey: 'home',
    name: 'Other',
    timezone: 'UTC',
  });
  const foreign = event({ confirmation: true }, 'DELETE', provision.member.memberId, 'foreign');
  expect((await remove(foreign, deps)).statusCode).toBe(404);
  expect(admin.deleteUser).toHaveBeenCalledTimes(1);
});
