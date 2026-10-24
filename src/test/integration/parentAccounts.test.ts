import {
  readHandler as readProfile,
  updateHandler as updateProfile,
} from '../../../lambdas/households/profile';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { simulateLambda } from '../../../local-dev/lambdaSimulator';
import { InMemoryHouseholdRepository } from '../../../lambdas/households/repository';
import type { CognitoAdministration } from '../../../lambdas/cognito/administration';
import {
  createParentHandler,
  activateParentHandler,
  pendingParentActionHandler,
} from '../../../lambdas/households/parentHandlers';
import { handler as recoveryEmailHandler } from '../../../lambdas/households/recoveryEmail';
import { handler as removeChildHandler } from '../../../lambdas/households/removeChild';
import { handler as bootstrapHandler } from '../../../lambdas/households/create';
import { handler as directoryHandler } from '../../../lambdas/households/directory';
async function fixture() {
  let n = 0;
  const repository = new InMemoryHouseholdRepository(() => `id-${++n}`);
  await repository.bootstrap({
    sub: 'parent',
    username: 'parent',
    idempotencyKey: 'boot',
    name: 'Home',
    timezone: 'UTC',
  });
  await repository.saveProfile({
    householdId: 'id-1',
    memberId: 'id-2',
    displayName: 'Parent',
    color: 'PINE',
    version: 0,
  });
  await repository.provisionChild({
    callerSub: 'parent',
    householdId: 'id-1',
    childSub: 'child',
    username: 'child',
    displayName: 'Child',
    color: 'LAKE',
    idempotencyKey: 'child',
  });
  const administration: CognitoAdministration = {
    createUser: vi.fn().mockResolvedValue({ sub: 'pending' }),
    canResendWelcome: vi.fn().mockResolvedValue(true),
    resendWelcome: vi.fn(),
    updatePendingParentEmail: vi.fn(),
    stageRecoveryEmail: vi.fn(),
    deleteUser: vi.fn(),
    setPermanentPassword: vi.fn(),
    globalSignOut: vi.fn(),
  };
  const verifier = {
    async verify(token: string) {
      if (!['parent', 'child', 'pending', 'unverified', 'stale-email'].includes(token))
        throw new Error('invalid');
      return {
        sub: ['unverified', 'stale-email'].includes(token) ? 'pending' : token,
        username: token,
        iat: 1800000000,
        exp: 2000000000,
        email:
          token === 'stale-email'
            ? 'old@example.test'
            : `${token === 'unverified' ? 'pending' : token}@example.test`,
        emailVerified: token !== 'unverified',
      };
    },
  };
  const dependencies = { repository, administration, verifier };
  const app = express();
  app.use(express.json());
  app.post('/api/v1/family-members/parents', (req, res) =>
    simulateLambda((e) => createParentHandler(e, dependencies), req, res),
  );
  app.post('/api/v1/parent-activations', (req, res) =>
    simulateLambda((e) => activateParentHandler(e, dependencies), req, res),
  );
  app.get('/api/v1/family-members', (req, res) =>
    simulateLambda((e) => directoryHandler(e, dependencies), req, res),
  );
  app.delete('/api/v1/family-members/:memberId', (req, res) =>
    simulateLambda((e) => removeChildHandler(e, dependencies), req, res),
  );
  app.put('/api/v1/family-members/:memberId/pending-email', (req, res) =>
    simulateLambda((e) => pendingParentActionHandler(e, dependencies), req, res),
  );
  app.get('/api/v1/security/recovery-email', (req, res) =>
    simulateLambda((e) => recoveryEmailHandler(e, dependencies), req, res),
  );
  app.put('/api/v1/security/recovery-email', (req, res) =>
    simulateLambda((e) => recoveryEmailHandler(e, dependencies), req, res),
  );
  app.get('/api/v1/profiles/me', (req, res) =>
    simulateLambda((e) => readProfile(e, dependencies), req, res),
  );
  app.put('/api/v1/profiles/me', (req, res) =>
    simulateLambda((e) => updateProfile(e, dependencies), req, res),
  );
  app.post('/api/v1/households', (req, res) =>
    simulateLambda((e) => bootstrapHandler(e, dependencies), req, res),
  );
  return { app, ...dependencies };
}
describe('family-account HTTP authorization and privacy', () => {
  it('creates and activates only the matching pending self with signed current-email proof', async () => {
    const f = await fixture();
    const input = {
      username: 'pending',
      email: 'pending@example.test',
    };
    const created = await request(f.app)
      .post('/api/v1/family-members/parents')
      .set('Authorization', 'Bearer parent')
      .set('Idempotency-Key', 'create')
      .send(input);
    expect(created.status).toBe(201);
    expect(created.headers['cache-control']).toBe('no-store');
    expect(created.body.member).not.toHaveProperty('email');
    for (const token of ['pending', 'unverified'])
      expect(
        (await request(f.app).get('/api/v1/family-members').set('Authorization', `Bearer ${token}`))
          .status,
      ).toBe(403);
    for (const token of ['unverified', 'stale-email'])
      expect(
        (
          await request(f.app)
            .post('/api/v1/parent-activations')
            .set('Authorization', `Bearer ${token}`)
        ).status,
      ).toBe(403);
    expect(
      (
        await request(f.app)
          .post('/api/v1/parent-activations')
          .set('Authorization', 'Bearer parent')
          .send({ memberId: 'id-4' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(f.app)
          .post('/api/v1/parent-activations')
          .set('Authorization', 'Bearer pending')
      ).status,
    ).toBe(200);
    expect(
      (await request(f.app).get('/api/v1/family-members').set('Authorization', 'Bearer pending'))
        .status,
    ).toBe(200);
    expect(
      (
        await request(f.app)
          .put('/api/v1/family-members/id-4/pending-email')
          .set('Authorization', 'Bearer parent')
          .set('Idempotency-Key', 'change')
          .send({ email: 'replacement@example.test' })
      ).status,
    ).toBe(403);
    expect(f.administration.updatePendingParentEmail).not.toHaveBeenCalled();
    const unset = await request(f.app)
      .get('/api/v1/profiles/me')
      .set('Authorization', 'Bearer pending');
    expect(unset.status).toBe(200);
    expect(unset.body.profile).toBeNull();
    const beforeSetup = await request(f.app)
      .get('/api/v1/family-members')
      .set('Authorization', 'Bearer parent');
    expect(
      beforeSetup.body.members.find(
        (member: { username: string }) => member.username === 'pending',
      ),
    ).not.toHaveProperty('displayName');
    const peerWrite = await request(f.app)
      .put('/api/v1/profiles/me')
      .set('Authorization', 'Bearer parent')
      .send({ displayName: 'Peer supplied', color: 'LAKE', version: 0, memberId: 'id-4' });
    expect(peerWrite.status).toBe(422);
    const ownWrite = await request(f.app)
      .put('/api/v1/profiles/me')
      .set('Authorization', 'Bearer pending')
      .send({ displayName: 'My chosen name', color: 'LAKE', version: 0 });
    expect(ownWrite.status).toBe(201);
    const afterSetup = await request(f.app)
      .get('/api/v1/family-members')
      .set('Authorization', 'Bearer parent');
    expect(
      afterSetup.body.members.find((member: { username: string }) => member.username === 'pending'),
    ).toMatchObject({ displayName: 'My chosen name', color: 'LAKE' });
  });
  it('keeps recovery email self-only, stages replacement without losing the old claim, and rejects overposted peer identity', async () => {
    const f = await fixture();
    expect(
      (
        await request(f.app)
          .get('/api/v1/security/recovery-email')
          .set('Authorization', 'Bearer child')
      ).status,
    ).toBe(403);
    const read = await request(f.app)
      .get('/api/v1/security/recovery-email')
      .set('Authorization', 'Bearer parent');
    expect(read.body).toEqual({ email: 'parent@example.test' });
    expect(read.headers['cache-control']).toBe('no-store');
    expect(
      (
        await request(f.app)
          .put('/api/v1/security/recovery-email')
          .set('Authorization', 'Bearer parent')
          .send({ email: 'new@example.test', memberId: 'peer' })
      ).status,
    ).toBe(422);
    expect(
      (
        await request(f.app)
          .put('/api/v1/security/recovery-email')
          .set('Authorization', 'Bearer parent')
          .send({ email: 'new@example.test' })
      ).status,
    ).toBe(202);
    expect(f.administration.stageRecoveryEmail).toHaveBeenCalledWith('parent', 'new@example.test');
    expect(
      (
        await request(f.app)
          .get('/api/v1/security/recovery-email')
          .set('Authorization', 'Bearer parent')
      ).body,
    ).toEqual({ email: 'parent@example.test' });
    expect(
      (await request(f.app).get('/api/v1/family-members').set('Authorization', 'Bearer parent'))
        .text,
    ).not.toContain('example.test');
  });
  it('denies missing/invalid sessions and child operations before administration', async () => {
    const f = await fixture();
    for (const token of ['', 'wrong-issuer', 'wrong-client', 'expired', 'child']) {
      const r = await request(f.app)
        .post('/api/v1/family-members/parents')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'x')
        .send({
          username: 'pending',
          email: 'email@example.test',
        });
      expect(r.status).toBe(token === 'child' ? 403 : 401);
    }
    expect(f.administration.createUser).not.toHaveBeenCalled();
  });
  it('removes child data and refuses stale-token household creation after lookup deletion', async () => {
    const f = await fixture();
    const removed = await request(f.app)
      .delete('/api/v1/family-members/id-3')
      .set('Authorization', 'Bearer parent')
      .set('Idempotency-Key', 'remove')
      .send({ confirmation: true });
    expect(removed.status).toBe(204);
    expect(
      (await request(f.app).get('/api/v1/family-members').set('Authorization', 'Bearer child'))
        .status,
    ).toBe(403);
    expect(
      (
        await request(f.app)
          .post('/api/v1/households')
          .set('Authorization', 'Bearer child')
          .set('Idempotency-Key', 'attempt-bootstrap')
          .send({ name: 'Forbidden', timezone: 'America/Chicago' })
      ).status,
    ).toBe(409);
  });
});
