import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { CognitoAdministration } from '../../../lambdas/cognito/administration';
import { InMemoryHouseholdRepository } from '../../../lambdas/households/repository';
import { handler } from '../../../lambdas/households/removeChild';
import {
  revocationExpiry,
  ID_TOKEN_VALIDITY_SECONDS,
  TOKEN_CLOCK_TOLERANCE_SECONDS,
  revocationKey,
  isRevoked,
} from '../../../lambdas/households/revocation';
import { childRemovalSteps } from '../../../lambdas/households/childRemoval';
function event(
  sub = 'parent',
  memberId = 'id-3',
  body: unknown = { confirmation: true },
): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    headers: { 'idempotency-key': 'remove' },
    pathParameters: { memberId },
    requestContext: {
      requestId: 'safe-request',
      http: { method: 'DELETE' },
      authorizer: { jwt: { claims: { token_use: 'id', sub, 'cognito:username': sub } } },
    },
  } as unknown as APIGatewayProxyEventV2;
}
async function fixture() {
  let n = 0;
  const repository = new InMemoryHouseholdRepository(() => `id-${++n}`);
  await repository.bootstrap({
    sub: 'parent',
    username: 'parent',
    idempotencyKey: 'home',
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
  const provision = {
    callerSub: 'parent',
    householdId: 'id-1',
    childSub: 'old-sub',
    username: 'child-one',
    displayName: 'Child private name',
    color: 'PINE' as const,
    idempotencyKey: 'child',
  };
  await repository.provisionChild(provision);
  const administration: CognitoAdministration = {
    createUser: vi.fn(),
    setPermanentPassword: vi.fn(),
    globalSignOut: vi.fn(),
    canResendWelcome: vi.fn().mockResolvedValue(true),
    resendWelcome: vi.fn(),
    updatePendingParentEmail: vi.fn(),
    stageRecoveryEmail: vi.fn(),
    deleteUser: vi.fn().mockResolvedValue(undefined),
  };
  return { repository, administration, provision };
}
afterEach(() => vi.useRealTimers());
describe('full child removal', () => {
  it('requires explicit confirmation, active parent and same-household active-child target before any mutation', async () => {
    const f = await fixture();
    for (const [sub, target, body, status] of [
      ['parent', 'id-3', { confirmation: false }, 422],
      ['old-sub', 'id-3', { confirmation: true }, 403],
      ['parent', 'id-2', { confirmation: true }, 403],
      ['parent', 'cross-household', { confirmation: true }, 404],
    ] as const) {
      expect((await handler(event(sub, target, body), f)).statusCode).toBe(status);
    }
    expect(f.administration.deleteUser).not.toHaveBeenCalled();
    expect((await f.repository.resolveMembership('old-sub')).kind).toBe('active');
  });
  it('purges profile and provisioning replays, denies stale-token bootstrap during absent lookup, then completes replay after immutable-identity deletion', async () => {
    const f = await fixture();
    let finish!: () => void;
    const external = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.mocked(f.administration.deleteUser).mockImplementation(() => external);
    const removal = handler(event(), f);
    await vi.waitFor(() => expect(f.administration.deleteUser).toHaveBeenCalledWith('old-sub'));
    expect(await f.repository.getProfile('id-1', 'id-3')).toBeNull();
    expect(await f.repository.getHouseholdMemberTarget('id-1', 'id-3')).toBeNull();
    expect(await f.repository.findChildProvisionReplay(f.provision)).toBeNull();
    expect((await f.repository.resolveMembership('old-sub')).kind).toBe('inactive');
    expect(
      await f.repository.bootstrap({
        sub: 'old-sub',
        username: 'child-one',
        idempotencyKey: 'new-house',
        name: 'Forbidden',
        timezone: 'UTC',
      }),
    ).toEqual({ kind: 'already-member' });
    expect(
      await f.repository.saveProfile({
        householdId: 'id-1',
        memberId: 'id-3',
        displayName: 'Late private profile',
        color: 'PINE',
        version: 0,
      }),
    ).toEqual({ kind: 'conflict', profile: null });
    finish();
    expect((await removal).statusCode).toBe(204);
    expect((await handler(event(), f)).statusCode).toBe(204);
    expect(f.administration.deleteUser).toHaveBeenCalledTimes(1);
  });
  it('keeps the hash marker non-expiring after uncertain Cognito deletion', async () => {
    const f = await fixture();
    vi.mocked(f.administration.deleteUser).mockRejectedValue(new Error('raw private identity'));
    const response = await handler(event(), f);
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('private');
    vi.useFakeTimers();
    vi.advanceTimersByTime(3 * 24 * 3600 * 1000);
    expect((await f.repository.resolveMembership('old-sub')).kind).toBe('inactive');
    expect(
      (
        await f.repository.bootstrap({
          sub: 'old-sub',
          username: 'child-one',
          name: 'Forbidden',
          timezone: 'UTC',
          idempotencyKey: 'retry',
        })
      ).kind,
    ).toBe('already-member');
  });
  it('expires the hash-only marker after confirmed deletion plus token lifetime and tolerance and allows unrelated username reuse', async () => {
    const f = await fixture();
    vi.useFakeTimers();
    const now = Date.now();
    expect((await handler(event(), f)).statusCode).toBe(204);
    expect(revocationExpiry(now)).toBe(
      Math.ceil(now / 1000) + ID_TOKEN_VALIDITY_SECONDS + TOKEN_CLOCK_TOLERANCE_SECONDS,
    );
    expect(JSON.stringify(revocationKey('old-sub'))).not.toContain('old-sub');
    expect(
      await f.repository.bootstrap({
        sub: 'new-unrelated-sub',
        username: 'child-one',
        name: 'New home',
        timezone: 'UTC',
        idempotencyKey: 'new',
      }),
    ).toMatchObject({ kind: 'created' });
    vi.advanceTimersByTime((ID_TOKEN_VALIDITY_SECONDS + TOKEN_CLOCK_TOLERANCE_SECONDS + 1) * 1000);
    expect((await f.repository.resolveMembership('old-sub')).kind).toBe('unattached');
  });
  it.each(childRemovalSteps.map((s) => s.kind))(
    'an interrupted %s step retains fail-closed identity and does not delete Cognito',
    async (kind) => {
      const f = await fixture();
      const target = await f.repository.getHouseholdMemberTarget('id-1', 'id-3');
      if (!target) throw new Error('fixture');
      const c = { householdId: 'id-1', target, owner: 'owner', parentSubs: ['parent'] };
      await f.repository.childRemoval.begin(c);
      await expect(
        f.repository.childRemoval.purge(c, [
          ...childRemovalSteps.filter((s) => s.kind !== kind),
          {
            kind,
            async remove() {
              throw new Error('dependency');
            },
          },
        ]),
      ).rejects.toThrow();
      expect((await f.repository.resolveMembership('old-sub')).kind).toBe('inactive');
      expect(f.administration.deleteUser).not.toHaveBeenCalled();
    },
  );
  it('an expired revocation read conditionally purges its exact marker without a raw identity lookup', async () => {
    const transact = vi.fn().mockResolvedValue(true),
      read = vi.fn().mockResolvedValue({ expiresAt: 1 });
    expect(await isRevoked({ read, transact }, 'old-sub', 2000)).toBe(false);
    expect(transact).toHaveBeenCalledWith([
      { key: revocationKey('old-sub'), expected: { expiresAt: 1 }, delete: true },
    ]);
  });
});
it.each(['begin', 'purge', 'complete'] as const)(
  'a failed %s boundary never reports removal success',
  async (boundary) => {
    const f = await fixture();
    const removal = f.repository.childRemoval;
    vi.spyOn(f.repository, 'childRemoval', 'get').mockReturnValue(removal);
    vi.spyOn(removal, boundary).mockRejectedValue(new Error('private dependency details'));
    const response = await handler(event(), f);
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('private');
    if (boundary === 'begin') {
      expect((await f.repository.resolveMembership('old-sub')).kind).toBe('active');
      expect(f.administration.deleteUser).not.toHaveBeenCalled();
    } else {
      expect((await f.repository.resolveMembership('old-sub')).kind).toBe('inactive');
      expect(f.administration.deleteUser).toHaveBeenCalledTimes(boundary === 'complete' ? 1 : 0);
    }
  },
);
