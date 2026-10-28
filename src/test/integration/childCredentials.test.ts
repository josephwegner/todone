import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { simulateLambda } from '../../../local-dev/lambdaSimulator';
import { handler as createChild } from '../../../lambdas/households/children';
import { handler as resetPassword } from '../../../lambdas/households/resetChildPassword';
import { handler as currentMembership } from '../../../lambdas/households/current';
import { readHandler as readProfile } from '../../../lambdas/households/profile';
import { InMemoryHouseholdRepository } from '../../../lambdas/households/repository';
import type { CognitoAdministration } from '../../../lambdas/cognito/administration';
import type { TokenVerifier } from '../../../lambdas/session/verifier';

async function fixture() {
  const ids = ['house', 'parent-member', 'child-member', 'other-house', 'other-member'];
  const repository = new InMemoryHouseholdRepository(() => ids.shift() ?? 'created-member');
  await repository.bootstrap({
    sub: 'parent',
    username: 'parent',
    name: 'Home',
    timezone: 'America/Chicago',
    idempotencyKey: 'parent',
  });
  await repository.provisionChild({
    callerSub: 'parent',
    householdId: 'house',
    childSub: 'child',
    username: 'child-one',
    displayName: 'Child',
    color: 'PINE',
    idempotencyKey: 'child',
  });
  await repository.bootstrap({
    sub: 'other',
    username: 'other',
    name: 'Other',
    timezone: 'America/Chicago',
    idempotencyKey: 'other',
  });
  const second = Math.floor(Date.parse('2026-10-19T12:00:00.500Z') / 1000);
  const verifier: TokenVerifier = {
    async verify(token) {
      if (
        !['parent', 'other', 'child-old', 'child-equal', 'child-new', 'child-missing'].includes(
          token,
        )
      )
        throw new Error('Invalid token');
      return {
        sub: token.startsWith('child-') ? 'child' : token,
        username: 'verified-username',
        exp: second + 3600,
        iat:
          token === 'child-missing'
            ? undefined
            : token === 'child-old'
              ? second - 1
              : token === 'child-equal'
                ? second
                : second + 1,
      };
    },
  };
  const calls: string[] = [];
  const administration: CognitoAdministration = {
    createUser: vi.fn(async () => ({ sub: 'created-child' })),
    async setPermanentPassword() {
      calls.push('password');
    },
    async globalSignOut() {
      calls.push('signout');
    },
    canResendWelcome: vi.fn().mockResolvedValue(true),
    resendWelcome: vi.fn(),
    updatePendingParentEmail: vi.fn(),
    stageRecoveryEmail: vi.fn(),
    deleteUser: vi.fn(),
  };
  const app = express();
  app.use(express.json());
  const deps = {
    repository,
    verifier,
    administration,
    now: () => new Date('2026-10-19T12:00:00.500Z'),
  };
  app.put('/api/v1/family-members/:memberId/password', async (req, res) =>
    simulateLambda((event) => resetPassword(event, deps), req, res),
  );
  app.post('/api/v1/family-members/children', async (req, res) =>
    simulateLambda((event) => createChild(event, deps), req, res),
  );
  app.get('/api/v1/memberships/current', async (req, res) =>
    simulateLambda((event) => currentMembership(event, deps), req, res),
  );
  app.get('/api/v1/profiles/me', async (req, res) =>
    simulateLambda((event) => readProfile(event, deps), req, res),
  );
  return { app, repository, calls, administration };
}

describe('child credentials through the HTTP simulator and real authorization middleware', () => {
  it('revokes old, equal-second, and missing-iat child sessions across protected APIs', async () => {
    const { app, calls, repository } = await fixture();
    const advance = vi.spyOn(repository, 'advanceCredentialsValidAfter');
    const reset = await request(app)
      .put('/api/v1/family-members/child-member/password')
      .set('Authorization', 'Bearer parent')
      .send({ password: 'Replacement1!' });
    expect(reset.status).toBe(204);
    expect(reset.headers['cache-control']).toBe('no-store');
    expect(calls).toEqual(['password', 'signout']);
    expect(advance).toHaveBeenCalledOnce();
    for (const token of ['child-old', 'child-equal', 'child-missing']) {
      for (const path of ['/api/v1/memberships/current', '/api/v1/profiles/me']) {
        const response = await request(app).get(path).set('Authorization', `Bearer ${token}`);
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('SESSION_REAUTHENTICATION_REQUIRED');
        expect(JSON.stringify(response.body)).not.toContain('Child');
      }
    }
    const fresh = await request(app)
      .get('/api/v1/memberships/current')
      .set('Authorization', 'Bearer child-new');
    expect(fresh.status).toBe(200);
    expect(fresh.body.membership.role).toBe('child');
  });

  it('treats a cross-household target the same as an absent target without side effects', async () => {
    const { app, calls } = await fixture();
    const responses = [];
    for (const memberId of ['child-member', 'absent']) {
      responses.push(
        await request(app)
          .put(`/api/v1/family-members/${memberId}/password`)
          .set('Authorization', 'Bearer other')
          .send({ password: 'Replacement1!' }),
      );
    }
    expect(responses.map((response) => response.status)).toEqual([404, 404]);
    expect(responses[0].body.error.code).toBe(responses[1].body.error.code);
    expect(calls).toEqual([]);
  });

  it('replays confirmed creation without repeating Cognito or using the password as replay input', async () => {
    const { app, administration } = await fixture();
    const input = {
      username: 'New-Child',
      displayName: 'New Child',
      color: 'PINE',
      password: 'InitialPassword1!',
    };
    const first = await request(app)
      .post('/api/v1/family-members/children')
      .set('Authorization', 'Bearer parent')
      .set('Idempotency-Key', 'new-child')
      .send(input);
    const replay = await request(app)
      .post('/api/v1/family-members/children')
      .set('Authorization', 'Bearer parent')
      .set('Idempotency-Key', 'new-child')
      .send({ ...input, password: 'ChangedPassword1!' });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(administration.createUser).toHaveBeenCalledOnce();
  });
});
