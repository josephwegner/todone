import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import {
  CognitoAdministrationError,
  CognitoAdministrationFailure,
  CognitoAdministrationOperation,
  type CognitoAdministration,
} from '../../../lambdas/cognito/administration';
import { handler } from '../../../lambdas/households/children';
import { handler as resetChildPassword } from '../../../lambdas/households/resetChildPassword';
import { InMemoryHouseholdRepository } from '../../../lambdas/households/repository';

const parentSub = 'parent-sub';
const householdId = 'household-id';

function request(overrides: Partial<{ body: unknown; idempotencyKey: string }> = {}) {
  return {
    version: '2.0',
    routeKey: 'POST /api/v1/family-members/children',
    rawPath: '/api/v1/family-members/children',
    rawQueryString: '',
    headers: { 'idempotency-key': overrides.idempotencyKey ?? 'create-child-one' },
    requestContext: {
      authorizer: {
        jwt: { claims: { token_use: 'id', sub: parentSub, 'cognito:username': 'parent-one' } },
      },
    },
    body: JSON.stringify(
      overrides.body ?? {
        username: 'child-one',
        displayName: 'Child One',
        color: 'PINE',
        password: 'A safe supplied password',
      },
    ),
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

async function parentRepository(): Promise<InMemoryHouseholdRepository> {
  const ids = [householdId, 'parent-member-id', 'child-member-id'];
  const repository = new InMemoryHouseholdRepository(() => ids.shift() ?? 'unused-id');
  await repository.bootstrap({
    sub: parentSub,
    username: 'parent-one',
    idempotencyKey: 'parent-bootstrap',
    name: 'River House',
    timezone: 'America/Chicago',
  });
  return repository;
}

function administration(calls: string[], failure?: Error): CognitoAdministration {
  return {
    async createUser(input) {
      calls.push(`create:${input.kind}:${input.username}`);
      if (failure) throw failure;
      return { sub: 'child-sub' };
    },
    async setPermanentPassword(username) {
      calls.push(`password:${username}`);
    },
    async canResendWelcome() {
      return true;
    },
    async resendWelcome() {},
    async updatePendingParentEmail() {},
    async stageRecoveryEmail() {},
    async deleteUser() {},
    async globalSignOut(username) {
      calls.push(`global-sign-out:${username}`);
    },
  };
}

describe('child provisioning handler', () => {
  it('creates an immediately active child membership and profile after parent authorization', async () => {
    const repository = await parentRepository();
    const calls: string[] = [];

    const response = await handler(request(), {
      repository,
      administration: administration(calls),
    });

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body ?? '')).toEqual({
      member: expect.objectContaining({
        username: 'child-one',
        role: 'child',
        activationState: 'ACTIVE',
        displayName: 'Child One',
        color: 'PINE',
      }),
    });
    expect(calls).toEqual(['create:child:child-one', 'password:child-one']);
    await expect(repository.resolveMembership('child-sub')).resolves.toMatchObject({
      kind: 'active',
      membership: { role: 'child', username: 'child-one' },
    });
  });

  it('replays a completed request without another Cognito call', async () => {
    const repository = await parentRepository();
    const calls: string[] = [];
    const dependencies = { repository, administration: administration(calls) };

    await handler(request(), dependencies);
    const replay = await handler(request(), dependencies);

    expect(replay.statusCode).toBe(200);
    expect(calls).toEqual(['create:child:child-one', 'password:child-one']);
  });

  it('rejects changed input for an idempotency key before another Cognito call', async () => {
    const repository = await parentRepository();
    const calls: string[] = [];
    const dependencies = { repository, administration: administration(calls) };

    await handler(request(), dependencies);
    const changed = await handler(
      request({
        body: { username: 'child-one', displayName: 'Changed', color: 'PINE', password: 'x' },
      }),
      dependencies,
    );

    expect(changed.statusCode).toBe(409);
    expect(JSON.parse(changed.body ?? '')).toMatchObject({
      error: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(calls).toEqual(['create:child:child-one', 'password:child-one']);
  });

  it('returns an accessible username conflict without exposing Cognito details', async () => {
    const repository = await parentRepository();
    const calls: string[] = [];
    const response = await handler(request(), {
      repository,
      administration: administration(
        calls,
        new CognitoAdministrationError(
          CognitoAdministrationFailure.usernameConflict,
          CognitoAdministrationOperation.createUser,
        ),
      ),
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body ?? '')).toMatchObject({
      error: {
        code: 'USERNAME_CONFLICT',
        fieldErrors: [{ field: 'username', code: 'USERNAME_CONFLICT' }],
      },
    });
  });

  it('makes a partial Cognito failure a generic request-ID error', async () => {
    const repository = await parentRepository();
    const calls: string[] = [];
    const response = await handler(request(), {
      repository,
      administration: administration(calls, new Error('private Cognito detail child-one')),
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body ?? '') as {
      error: { message: string; requestId: string };
    };
    expect(body.error.message).not.toContain('child-one');
    expect(body.error.requestId).toEqual(expect.any(String));
  });

  it('resets only a same-household child, signs it out, and cuts off prior tokens', async () => {
    const repository = await parentRepository();
    const calls: string[] = [];
    await handler(request(), { repository, administration: administration(calls) });
    const response = await resetChildPassword(
      {
        ...request({ body: { password: 'ReplacementPassword1!' } }),
        pathParameters: { memberId: 'child-member-id' },
      },
      {
        repository,
        administration: administration(calls),
        now: () => new Date('2026-08-30T12:00:00.000Z'),
      },
    );

    expect(response.statusCode).toBe(204);
    expect(calls).toContain('password:child-sub');
    expect(calls).toContain('global-sign-out:child-sub');
    await expect(repository.resolveMembership('child-sub', 1788091200)).resolves.toEqual({
      kind: 'credentials-stale',
    });
  });

  it('denies a peer-parent target before any Cognito call', async () => {
    const repository = await parentRepository();
    const calls: string[] = [];
    const response = await resetChildPassword(
      {
        ...request({ body: { password: 'ReplacementPassword1!' } }),
        pathParameters: { memberId: 'parent-member-id' },
      },
      { repository, administration: administration(calls) },
    );

    expect(response.statusCode).toBe(403);
    expect(calls).toEqual([]);
  });
});
