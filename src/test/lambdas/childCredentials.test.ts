import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  CognitoAdministrationError,
  CognitoAdministrationFailure,
  CognitoAdministrationOperation,
  type CognitoAdministration,
} from '../../../lambdas/cognito/administration';
import { handler as createChild } from '../../../lambdas/households/children';
import { handler as resetPassword } from '../../../lambdas/households/resetChildPassword';
import { InMemoryHouseholdRepository } from '../../../lambdas/households/repository';
import { MembershipRecordRepository } from '../helpers/membershipRecordRepository';

const cutoff = new Date('2026-10-19T12:00:00.500Z');
const input = {
  username: 'Child-One',
  displayName: 'Child One',
  color: 'PINE',
  password: 'CanaryCredential1!',
};

function request(
  sub = 'parent',
  body: unknown = { password: input.password },
  memberId = 'child-member',
) {
  return {
    headers: { 'idempotency-key': 'create-one' },
    pathParameters: { memberId },
    body: JSON.stringify(body),
    requestContext: {
      requestId: 'test-request',
      http: { method: 'PUT' },
      authorizer: {
        jwt: { claims: { token_use: 'id', sub, 'cognito:username': sub, iat: 1800000000 } },
      },
    },
  } as unknown as APIGatewayProxyEventV2;
}

async function fixture() {
  const ids = ['house', 'parent-member', 'child-member', 'other-house', 'other-parent'];
  const repository = new InMemoryHouseholdRepository(() => ids.shift()!);
  await repository.bootstrap({
    sub: 'parent',
    username: 'parent-one',
    idempotencyKey: 'parent',
    name: 'Home',
    timezone: 'America/Chicago',
  });
  await repository.provisionChild({
    callerSub: 'parent',
    householdId: 'house',
    childSub: 'child',
    username: 'child-one',
    displayName: 'Child One',
    color: 'PINE',
    idempotencyKey: 'child',
  });
  await repository.bootstrap({
    sub: 'other-parent',
    username: 'other-parent',
    idempotencyKey: 'other',
    name: 'Other',
    timezone: 'America/Chicago',
  });
  const administration: CognitoAdministration = {
    createUser: vi.fn(async () => ({ sub: 'new-child' })),
    setPermanentPassword: vi.fn(async () => {}),
    globalSignOut: vi.fn(async () => {}),
    canResendWelcome: vi.fn().mockResolvedValue(true),
    resendWelcome: vi.fn(),
    updatePendingParentEmail: vi.fn(),
    stageRecoveryEmail: vi.fn(),
    deleteUser: vi.fn(),
  };
  return { repository, administration, now: () => cutoff };
}

afterEach(() => vi.restoreAllMocks());

describe('child credential authorization and failures', () => {
  it.each(['PENDING_ACTIVATION', 'INACTIVE'] as const)(
    'denies a %s caller before target reads',
    async (state) => {
      const deps = await fixture();
      const repository = new MembershipRecordRepository('parent', {
        lookup: {
          householdId: 'house',
          memberId: 'parent-member',
          username: 'parent',
          role: 'parent',
          activationState: state,
        },
        household: {
          householdId: 'house',
          name: 'Home',
          timezone: 'America/Chicago',
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        membership: {
          householdId: 'house',
          memberId: 'parent-member',
          username: 'parent',
          sub: 'parent',
          role: 'parent',
          activationState: state,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      });
      const readTarget = vi.spyOn(repository, 'getHouseholdMemberTarget');
      expect((await resetPassword(request(), { ...deps, repository })).statusCode).toBe(403);
      expect(readTarget).not.toHaveBeenCalled();
      expect(deps.administration.setPermanentPassword).not.toHaveBeenCalled();
    },
  );

  it('rejects unavailable local sign-out before changing any credentials', async () => {
    const deps = await fixture();
    const response = await resetPassword(request(), { ...deps, passwordResetAvailable: false });
    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('No password was changed');
    expect(deps.administration.setPermanentPassword).not.toHaveBeenCalled();
    expect(deps.administration.globalSignOut).not.toHaveBeenCalled();
  });
  it.each([
    ['anonymous', '', 'child-member', 401],
    ['child', 'child', 'child-member', 403],
    ['unattached', 'unknown', 'child-member', 403],
    ['cross-household', 'other-parent', 'child-member', 404],
    ['missing', 'parent', 'absent', 404],
    ['peer parent', 'parent', 'parent-member', 403],
  ])('denies %s before Cognito', async (_label, sub, target, status) => {
    const deps = await fixture();
    const event = request(sub, undefined, target);
    if (!sub) delete event.requestContext.authorizer;
    const result = await resetPassword(event, deps);
    expect(result.statusCode).toBe(status);
    expect(deps.administration.setPermanentPassword).not.toHaveBeenCalled();
    expect(deps.administration.globalSignOut).not.toHaveBeenCalled();
  });

  it.each(['PENDING_ACTIVATION', 'INACTIVE'] as const)('rejects a %s target', async (state) => {
    const deps = await fixture();
    const original = await deps.repository.getHouseholdMemberTarget('house', 'child-member');
    vi.spyOn(deps.repository, 'getHouseholdMemberTarget').mockResolvedValue({
      ...original!,
      activationState: state,
    });
    expect((await resetPassword(request(), deps)).statusCode).toBe(403);
    expect(deps.administration.setPermanentPassword).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { password: '' },
    { password: 2 },
    { password: input.password, role: 'parent' },
    [],
  ])('rejects invalid/overposted reset input before mutation', async (body) => {
    const deps = await fixture();
    expect((await resetPassword(request('parent', body), deps)).statusCode).toBe(422);
    expect(deps.administration.setPermanentPassword).not.toHaveBeenCalled();
  });

  it('maps Cognito password policy rejection to a field error without advancing the cutoff', async () => {
    const deps = await fixture();
    vi.mocked(deps.administration.setPermanentPassword).mockRejectedValue(
      new CognitoAdministrationError(
        CognitoAdministrationFailure.invalidPassword,
        CognitoAdministrationOperation.setPermanentPassword,
      ),
    );
    const result = await resetPassword(request(), deps);
    expect(result.statusCode).toBe(422);
    expect(JSON.parse(result.body!).error.fieldErrors[0].field).toBe('password');
    expect(deps.administration.globalSignOut).not.toHaveBeenCalled();
    expect((await deps.repository.resolveMembership('child')).kind).toBe('active');
  });

  it.each(['password', 'signout', 'cutoff', 'target'])(
    'keeps a %s dependency failure private and never reports success',
    async (stage) => {
      const deps = await fixture();
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const failure = new Error(`private ${input.password} child-one child house`);
      if (stage === 'password')
        vi.mocked(deps.administration.setPermanentPassword).mockRejectedValue(failure);
      if (stage === 'signout')
        vi.mocked(deps.administration.globalSignOut).mockRejectedValue(failure);
      if (stage === 'cutoff')
        vi.spyOn(deps.repository, 'advanceCredentialsValidAfter').mockRejectedValue(failure);
      if (stage === 'target')
        vi.spyOn(deps.repository, 'getHouseholdMemberTarget').mockRejectedValue(failure);
      const result = await resetPassword(request(), deps);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body!).error.requestId).toBe('test-request');
      const output = JSON.stringify([result, log.mock.calls]);
      expect(output).not.toContain(input.password);
      expect(output).not.toContain('private');
      if (stage === 'password' || stage === 'target')
        expect(deps.administration.globalSignOut).not.toHaveBeenCalled();
    },
  );

  it('normalizes case variants before the Cognito uniqueness check', async () => {
    const deps = await fixture();
    vi.mocked(deps.administration.createUser).mockRejectedValue(
      new CognitoAdministrationError(
        CognitoAdministrationFailure.usernameConflict,
        CognitoAdministrationOperation.createUser,
      ),
    );
    const result = await createChild(request('parent', input), deps);
    expect(result.statusCode).toBe(409);
    expect(deps.administration.createUser).toHaveBeenCalledWith({
      kind: 'child',
      username: 'child-one',
    });
    expect(deps.administration.setPermanentPassword).not.toHaveBeenCalled();
  });

  it('reports a provisioning persistence split without repeating it or logging private input', async () => {
    const deps = await fixture();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(deps.repository, 'provisionChild').mockRejectedValue(new Error(input.password));
    const result = await createChild(request('parent', input), deps);
    expect(result.statusCode).toBe(500);
    expect(JSON.stringify([result, log.mock.calls])).not.toContain(input.password);
    expect(deps.administration.createUser).toHaveBeenCalledTimes(1);
  });
});
