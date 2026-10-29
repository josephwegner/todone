import { Capability } from '../../../shared/authorizationCapabilities';
import { describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  CognitoAdministrationError,
  type CognitoAdministration,
} from '../../../lambdas/cognito/administration';
import { InMemoryHouseholdRepository } from '../../../lambdas/households/repository';
import {
  activateParentHandler,
  createParentHandler,
  pendingParentActionHandler,
} from '../../../lambdas/households/parentHandlers';
const parent = 'owner';
function event(
  sub = parent,
  input?: unknown,
  method = 'POST',
  memberId?: string,
  claims: Record<string, unknown> = {},
): APIGatewayProxyEventV2 {
  return {
    body: input === undefined ? undefined : JSON.stringify(input),
    headers: { 'idempotency-key': 'request-one' },
    pathParameters: memberId ? { memberId } : undefined,
    requestContext: {
      requestId: 'request-safe',
      http: { method },
      authorizer: { jwt: { claims: { token_use: 'id', sub, 'cognito:username': sub, ...claims } } },
    },
  } as unknown as APIGatewayProxyEventV2;
}
async function fixture() {
  let n = 0;
  const repository = new InMemoryHouseholdRepository(() => `id-${++n}`);
  const b = await repository.bootstrap({
    sub: parent,
    username: parent,
    idempotencyKey: 'boot',
    name: 'Home',
    timezone: 'UTC',
  });
  if (!('membership' in b)) throw new Error('fixture');
  await repository.saveProfile({
    householdId: b.membership.household.householdId,
    memberId: b.membership.memberId,
    displayName: 'Owner',
    color: 'PINE',
    version: 0,
  });
  const administration: CognitoAdministration = {
    createUser: vi.fn().mockResolvedValue({ sub: 'pending' }),
    canResendWelcome: vi.fn().mockResolvedValue(true),
    resendWelcome: vi.fn().mockResolvedValue(undefined),
    updatePendingParentEmail: vi.fn().mockResolvedValue(undefined),
    stageRecoveryEmail: vi.fn().mockResolvedValue(undefined),
    setPermanentPassword: vi.fn(),
    deleteUser: vi.fn().mockResolvedValue(undefined),
    globalSignOut: vi.fn(),
  };
  const details = {
    username: 'New-Parent',
    email: 'first@example.test',
  };
  return { repository, administration, details };
}
describe('parent handlers', () => {
  it('creates/replays one safe pending parent without password or email verification administration', async () => {
    const f = await fixture();
    const e = event(parent, f.details);
    const created = await createParentHandler(e, f),
      replayed = await createParentHandler(e, f);
    expect(created.statusCode).toBe(201);
    expect(replayed.statusCode).toBe(200);
    expect(created.body).toBe(replayed.body);
    expect(JSON.parse(created.body!).member).toEqual({
      allowedActions: [
        Capability.pendingParentCancel,
        Capability.pendingParentEmail,
        Capability.pendingParentResend,
      ],
      memberId: 'id-3',
      username: 'new-parent',
      role: 'parent',
      activationState: 'PENDING_ACTIVATION',
    });
    expect(JSON.stringify(Object.keys(JSON.parse(created.body!).member))).not.toMatch(
      /email|digest|salt|sub|displayName|color/,
    );
    expect(created.body).not.toContain(f.details.email);
    expect(await f.repository.getProfile('id-1', 'id-3')).toBeNull();
    expect(f.administration.createUser).toHaveBeenCalledTimes(1);
    expect(f.administration.setPermanentPassword).not.toHaveBeenCalled();
    expect(
      (await createParentHandler(event(parent, { ...f.details, email: 'other@example.test' }), f))
        .statusCode,
    ).toBe(409);
  });
  it('denies a forged role and malformed or overposted inputs before external calls', async () => {
    const f = await fixture();
    for (const input of [
      { ...f.details, role: 'parent' },
      { ...f.details, displayName: 'Inviter chosen name' },
      { ...f.details, color: 'PINE' },
      { ...f.details, email: 'invalid' },
      { ...f.details, username: 'a' },
    ])
      expect(
        (await createParentHandler(event(parent, input), f)).statusCode,
      ).toBeGreaterThanOrEqual(400);
    expect((await createParentHandler(event('unattached', f.details), f)).statusCode).toBe(403);
    expect(f.administration.createUser).not.toHaveBeenCalled();
  });
  it('never grants authority after password setup without signed proof for the current email', async () => {
    const f = await fixture();
    await createParentHandler(event(parent, f.details), f);
    for (const claims of [
      {},
      { email: f.details.email, email_verified: false },
      { email: 'other@example.test', email_verified: true },
      { email: f.details.email, email_verified: 'TRUE' },
    ])
      expect(
        (await activateParentHandler(event('pending', undefined, 'POST', undefined, claims), f))
          .statusCode,
      ).toBe(403);
    expect(await f.repository.resolveMembership('pending')).toEqual({ kind: 'pending-activation' });
    const e = event('pending', undefined, 'POST', undefined, {
      email: f.details.email,
      email_verified: 'true',
    });
    expect((await activateParentHandler(e, f)).statusCode).toBe(200);
    expect(await f.repository.getProfile('id-1', 'id-3')).toBeNull();
    expect((await activateParentHandler(e, f)).statusCode).toBe(200);
    expect(
      (await activateParentHandler(event('pending', { email: f.details.email }, 'POST'), f))
        .statusCode,
    ).toBe(400);
  });
  it('explicitly denies unsupported local activation before acquiring ownership or changing state', async () => {
    const f = await fixture();
    await createParentHandler(event(parent, f.details), f);
    const response = await activateParentHandler(
      event('pending', undefined, 'POST', undefined, {
        email: f.details.email,
        email_verified: true,
      }),
      { ...f, activationAvailable: false },
    );
    expect(response.statusCode).toBe(503);
    expect(await f.repository.resolveMembership('pending')).toEqual({ kind: 'pending-activation' });
    const c = await f.repository.pendingParents.context('pending');
    await expect(f.repository.pendingParents.acquire(c, 'still-free')).resolves.toBeUndefined();
  });
  it.each(['email', 'cancel', 'resend'] as const)(
    'activation winning prevents %s from touching an active peer',
    async (action) => {
      const f = await fixture();
      await createParentHandler(event(parent, f.details), f);
      await activateParentHandler(
        event('pending', undefined, 'POST', undefined, {
          email: f.details.email,
          email_verified: true,
        }),
        f,
      );
      const response = await pendingParentActionHandler(
        event(
          parent,
          action === 'email'
            ? { email: 'replacement@example.test' }
            : action === 'cancel'
              ? { confirmation: true }
              : undefined,
          action === 'email' ? 'PUT' : action === 'cancel' ? 'DELETE' : 'POST',
          'id-3',
        ),
        f,
      );
      expect(response.statusCode).toBe(403);
      expect(f.administration.resendWelcome).not.toHaveBeenCalled();
      expect(f.administration.updatePendingParentEmail).not.toHaveBeenCalled();
      expect(f.administration.deleteUser).not.toHaveBeenCalled();
    },
  );
  it('holds ownership during a suspended email update and rejects the earlier verified address afterwards', async () => {
    const f = await fixture();
    await createParentHandler(event(parent, f.details), f);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(f.administration.updatePendingParentEmail).mockImplementation(() => gate);
    const change = pendingParentActionHandler(
      event(parent, { email: 'replacement@example.test' }, 'PUT', 'id-3'),
      f,
    );
    await vi.waitFor(() => expect(f.administration.updatePendingParentEmail).toHaveBeenCalled());
    const activation = event('pending', undefined, 'POST', undefined, {
      email: f.details.email,
      email_verified: true,
    });
    expect((await activateParentHandler(activation, f)).statusCode).toBe(409);
    finish();
    expect((await change).statusCode).toBe(204);
    expect((await activateParentHandler(activation, f)).statusCode).toBe(403);
    expect(
      (
        await activateParentHandler(
          event('pending', undefined, 'POST', undefined, {
            email: 'replacement@example.test',
            email_verified: true,
          }),
          f,
        )
      ).statusCode,
    ).toBe(200);
  });
  it('retains ownership after uncertain external outcomes without logging contact or raw provider failures', async () => {
    const f = await fixture();
    await createParentHandler(event(parent, f.details), f);
    vi.mocked(f.administration.resendWelcome).mockRejectedValue(
      new Error('private@example.test provider secret'),
    );
    const e = event(parent, undefined, 'POST', 'id-3');
    const response = await pendingParentActionHandler(e, f);
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toMatch(/private|secret|provider/);
    const c = await f.repository.pendingParents.context('pending');
    await expect(f.repository.pendingParents.acquire(c, 'retry')).rejects.toMatchObject({
      kind: 'conflict',
    });
    expect(
      (
        await activateParentHandler(
          event('pending', undefined, 'POST', undefined, {
            email: f.details.email,
            email_verified: true,
          }),
          f,
        )
      ).statusCode,
    ).toBe(409);
  });
  it('cancellation wins, replays safely after deletion, and cannot resurrect activation', async () => {
    const f = await fixture();
    await createParentHandler(event(parent, f.details), f);
    const e = event(parent, { confirmation: true }, 'DELETE', 'id-3');
    expect((await pendingParentActionHandler(e, f)).statusCode).toBe(204);
    expect((await pendingParentActionHandler(e, f)).statusCode).toBe(204);
    expect(f.administration.deleteUser).toHaveBeenCalledTimes(1);
    expect(f.administration.deleteUser).toHaveBeenCalledWith('pending');
    expect(
      (
        await activateParentHandler(
          event('pending', undefined, 'POST', undefined, {
            email: f.details.email,
            email_verified: true,
          }),
          f,
        )
      ).statusCode,
    ).toBe(403);
    expect(await f.repository.getHouseholdMemberTarget('id-1', 'id-3')).toBeNull();
  });
});
it('API Gateway access-token or missing-kind claims cannot supply activation email proof', async () => {
  const f = await fixture();
  await createParentHandler(event(parent, f.details), f);
  for (const token_use of ['access', undefined]) {
    const response = await activateParentHandler(
      event('pending', undefined, 'POST', undefined, {
        token_use,
        email: f.details.email,
        email_verified: true,
      }),
      f,
    );
    expect(response.statusCode).toBe(401);
  }
  expect((await f.repository.resolveMembership('pending')).kind).toBe('pending-activation');
});
it.each(['resend', 'cancel'] as const)(
  'holds ownership while delayed %s wins against activation',
  async (action) => {
    const f = await fixture();
    await createParentHandler(event(parent, f.details), f);
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const operation =
      action === 'resend' ? f.administration.resendWelcome : f.administration.deleteUser;
    vi.mocked(operation).mockImplementation(() => gate);
    const mutation = pendingParentActionHandler(
      event(
        parent,
        action === 'cancel' ? { confirmation: true } : undefined,
        action === 'cancel' ? 'DELETE' : 'POST',
        'id-3',
      ),
      f,
    );
    await vi.waitFor(() => expect(operation).toHaveBeenCalled());
    const activation = event('pending', undefined, 'POST', undefined, {
      email: f.details.email,
      email_verified: true,
    });
    expect((await activateParentHandler(activation, f)).statusCode).toBe(409);
    finish();
    expect((await mutation).statusCode).toBe(204);
    expect((await activateParentHandler(activation, f)).statusCode).toBe(
      action === 'cancel' ? 403 : 200,
    );
  },
);
it('a failed final pending write retains ownership after confirmed external completion', async () => {
  const f = await fixture();
  await createParentHandler(event(parent, f.details), f);
  const pending = f.repository.pendingParents;
  vi.spyOn(f.repository, 'pendingParents', 'get').mockReturnValue(pending);
  vi.spyOn(pending, 'finish').mockRejectedValue(new Error('write failed'));
  expect(
    (
      await pendingParentActionHandler(
        event(parent, { email: 'replacement@example.test' }, 'PUT', 'id-3'),
        f,
      )
    ).statusCode,
  ).toBe(500);
  expect(f.administration.updatePendingParentEmail).toHaveBeenCalledTimes(1);
  expect(f.administration.resendWelcome).toHaveBeenCalledTimes(1);
  const current = await f.repository.pendingParents.context('pending');
  await expect(f.repository.pendingParents.acquire(current, 'other')).rejects.toMatchObject({
    kind: 'conflict',
  });
});

it.each(['POST', 'PUT'])(
  'rejects %s invitation actions after password setup without changing email or locking activation',
  async (method) => {
    const f = await fixture();
    await createParentHandler(event(parent, f.details), f);
    vi.mocked(f.administration.canResendWelcome).mockResolvedValue(false);
    const response = await pendingParentActionHandler(
      event(
        parent,
        method === 'PUT' ? { email: 'replacement@example.test' } : undefined,
        method,
        'id-3',
      ),
      f,
    );
    expect(response.statusCode).toBe(409);
    expect(f.administration.canResendWelcome).toHaveBeenCalledWith('pending');
    expect(f.administration.updatePendingParentEmail).not.toHaveBeenCalled();
    expect(f.administration.resendWelcome).not.toHaveBeenCalled();
    expect(
      (
        await activateParentHandler(
          event('pending', undefined, 'POST', undefined, {
            email: f.details.email,
            email_verified: true,
          }),
          f,
        )
      ).statusCode,
    ).toBe(200);
  },
);

it.each(['invalid-state', 'throttled'] as const)(
  'releases a definitive pure resend %s rejection',
  async (kind) => {
    const f = await fixture();
    await createParentHandler(event(parent, f.details), f);
    vi.mocked(f.administration.resendWelcome).mockRejectedValue(
      new CognitoAdministrationError(kind, 'resend-welcome'),
    );
    expect(
      (await pendingParentActionHandler(event(parent, undefined, 'POST', 'id-3'), f)).statusCode,
    ).toBe(kind === 'throttled' ? 429 : 409);
    expect(
      (
        await activateParentHandler(
          event('pending', undefined, 'POST', undefined, {
            email: f.details.email,
            email_verified: true,
          }),
          f,
        )
      ).statusCode,
    ).toBe(200);
  },
);

it('retains ownership when password setup races email update and resend rejects', async () => {
  const f = await fixture();
  await createParentHandler(event(parent, f.details), f);
  vi.mocked(f.administration.resendWelcome).mockRejectedValue(
    new CognitoAdministrationError('invalid-state', 'resend-welcome'),
  );
  expect(
    (
      await pendingParentActionHandler(
        event(parent, { email: 'replacement@example.test' }, 'PUT', 'id-3'),
        f,
      )
    ).statusCode,
  ).toBe(500);
  expect(f.administration.updatePendingParentEmail).toHaveBeenCalledTimes(1);
  expect(
    (
      await activateParentHandler(
        event('pending', undefined, 'POST', undefined, {
          email: f.details.email,
          email_verified: true,
        }),
        f,
      )
    ).statusCode,
  ).toBe(409);
});

it('releases ownership on read-only provider failure', async () => {
  const f = await fixture();
  await createParentHandler(event(parent, f.details), f);
  vi.mocked(f.administration.canResendWelcome).mockRejectedValue(new Error('read failed'));
  expect(
    (await pendingParentActionHandler(event(parent, undefined, 'POST', 'id-3'), f)).statusCode,
  ).toBe(500);
  expect(f.administration.resendWelcome).not.toHaveBeenCalled();
  expect(
    (
      await activateParentHandler(
        event('pending', undefined, 'POST', undefined, {
          email: f.details.email,
          email_verified: true,
        }),
        f,
      )
    ).statusCode,
  ).toBe(200);
});
