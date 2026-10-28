import { describe, expect, it } from 'vitest';
import { InMemoryHouseholdRepository } from '../../../lambdas/households/repository';
import {
  proofMatches,
  PendingParentRoute,
  digestInput,
} from '../../../lambdas/households/pendingParents';
async function fixture() {
  let count = 0;
  const repository = new InMemoryHouseholdRepository(() => `id-${++count}`);
  const boot = await repository.bootstrap({
    sub: 'parent',
    username: 'parent',
    idempotencyKey: 'boot',
    name: 'Home',
    timezone: 'UTC',
  });
  if (!('membership' in boot)) throw new Error('fixture');
  const householdId = boot.membership.household.householdId;
  await repository.saveProfile({
    householdId,
    memberId: boot.membership.memberId,
    displayName: 'Parent',
    color: 'PINE',
    version: 0,
  });
  const input = {
    callerSub: 'parent',
    householdId,
    username: 'new-parent',
    email: 'first@example.test',
    idempotencyKey: 'create',
  };
  await repository.pendingParents.provision(input, 'pending-sub');
  const context = await repository.pendingParents.context('pending-sub');
  return { repository, context, input };
}
describe('pending-parent binding and ownership', () => {
  it('provisions pending copies and keeps raw email and binding outside all directory projections', async () => {
    const { repository, context } = await fixture();
    expect(await repository.resolveMembership(context.sub)).toEqual({ kind: 'pending-activation' });
    const members = await repository.listFamilyMembers(context.householdId);
    expect(members).toContainEqual(
      expect.objectContaining({ username: 'new-parent', activationState: 'PENDING_ACTIVATION' }),
    );
    expect(JSON.stringify(members)).not.toMatch(/email|digest|salt|version|Owner/i);
    expect(proofMatches(context, 'first@example.test', true)).toBe(true);
    for (const proof of [false, undefined, 'true', 1])
      expect(proofMatches(context, 'first@example.test', proof)).toBe(false);
    expect(proofMatches(context, 'other@example.test', true)).toBe(false);
  });
  it('allows exactly one concurrent owner and rejects a wrong-owner release or activation', async () => {
    const { repository, context } = await fixture();
    const pending = repository.pendingParents;
    const results = await Promise.allSettled([
      pending.acquire(context, 'one'),
      pending.acquire(context, 'two'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await expect(pending.release(context, 'wrong')).rejects.toMatchObject({ kind: 'conflict' });
    await expect(pending.activate(context, 'wrong')).rejects.toMatchObject({ kind: 'conflict' });
    await expect(pending.acquire(context, 'later')).rejects.toMatchObject({ kind: 'conflict' });
    await pending.release(context, 'one');
    await pending.acquire(context, 'later');
  });
  it('invalidates the earlier email binding and version before releasing ownership', async () => {
    const { repository, context } = await fixture();
    const p = repository.pendingParents;
    await p.acquire(context, 'email');
    await p.finish(
      context,
      'email',
      {
        callerSub: 'parent',
        route: PendingParentRoute.email,
        target: context.memberId,
        key: 'change',
        digest: digestInput('replacement@example.test'),
      },
      'email',
      'replacement@example.test',
    );
    const current = await p.context(context.sub);
    expect(current.version).toBe(context.version + 1);
    expect(proofMatches(current, 'first@example.test', true)).toBe(false);
    expect(proofMatches(current, 'replacement@example.test', true)).toBe(true);
    await expect(p.acquire(context, 'stale')).rejects.toMatchObject({ kind: 'conflict' });
  });
  it('activation atomically closes all future pending operations and deletes the binding', async () => {
    const { repository, context } = await fixture();
    const p = repository.pendingParents;
    await p.acquire(context, 'activation');
    await p.activate(context, 'activation');
    expect(await repository.resolveMembership(context.sub)).toMatchObject({
      kind: 'active',
      membership: { role: 'parent' },
    });
    await expect(p.acquire(context, 'cancel')).rejects.toMatchObject({ kind: 'conflict' });
    await expect(p.context(context.sub)).rejects.toMatchObject({ kind: 'unavailable' });
  });
  it('cancellation keeps ownership through external work and only a completed replay survives deletion', async () => {
    const { repository, context } = await fixture();
    const p = repository.pendingParents;
    const replay = {
      callerSub: 'parent',
      route: PendingParentRoute.cancel,
      target: context.memberId,
      key: 'cancel',
      digest: digestInput('true'),
    };
    await p.acquire(context, 'cancel');
    await expect(p.acquire(context, 'activate')).rejects.toMatchObject({ kind: 'conflict' });
    await p.finish(context, 'cancel', replay, 'cancel');
    await expect(p.context(context.sub)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(await p.replay(replay)).toMatchObject({ target: context.memberId });
    await expect(p.replay({ ...replay, digest: 'different' })).rejects.toMatchObject({
      kind: 'conflict',
    });
  });
});

import {
  DynamoConditionalRecordStore,
  PendingParentRepository,
  type PendingParentContext,
} from '../../../lambdas/households/pendingParents';
import {
  GetItemCommand,
  TransactWriteItemsCommand,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { vi } from 'vitest';
it('DynamoDB acquires both pending-copy conditions atomically and never adds a lease or expiry', async () => {
  const c: PendingParentContext = {
    sub: 'sub',
    memberId: 'member',
    householdId: 'home',
    username: 'pending',
    salt: 'salt',
    digest: digestInput('salt', 'email@example.test'),
    version: 1,
  };
  const row = (v: Record<string, string | number>) =>
    Object.fromEntries(
      Object.entries(v).map(([k, v]) => [k, typeof v === 'number' ? { N: String(v) } : { S: v }]),
    );
  const send = vi
    .fn()
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      Item: row({
        householdId: c.householdId,
        memberId: c.memberId,
        username: c.username,
        role: 'parent',
        activationState: 'PENDING_ACTIVATION',
        pendingVersion: 1,
        emailBindingSalt: c.salt,
        emailBindingDigest: c.digest,
        pendingOperationOwner: 'owner',
      }),
    })
    .mockResolvedValueOnce({
      Item: row({
        memberId: c.memberId,
        sub: c.sub,
        username: c.username,
        role: 'parent',
        activationState: 'PENDING_ACTIVATION',
        pendingVersion: 1,
      }),
    })
    .mockResolvedValueOnce({ Item: row({ householdId: c.householdId }) });
  const p = new PendingParentRepository(
    new DynamoConditionalRecordStore('table', { send } as unknown as DynamoDBClient),
  );
  await p.acquire(c, 'owner');
  const command = send.mock.calls[0]![0] as TransactWriteItemsCommand;
  expect(command).toBeInstanceOf(TransactWriteItemsCommand);
  expect(command.input.TransactItems).toHaveLength(2);
  const update = command.input.TransactItems![0]!.Update!;
  expect(update.ExpressionAttributeNames).toMatchObject({ '#s0': 'pendingOperationOwner' });
  expect(Object.values(update.ExpressionAttributeNames!)).toEqual(
    expect.arrayContaining([
      'activationState',
      'pendingVersion',
      'emailBindingDigest',
      'pendingOperationOwner',
    ]),
  );
  expect(update.ConditionExpression).toContain('attribute_not_exists');
  const condition = command.input.TransactItems![1]!.ConditionCheck!;
  expect(Object.values(condition.ExpressionAttributeNames!)).toEqual(
    expect.arrayContaining(['sub', 'role', 'activationState', 'pendingVersion']),
  );
  expect(JSON.stringify(command.input)).not.toMatch(/ttl|lease|expire/i);
  for (const [read] of send.mock.calls.slice(1)) {
    expect(read).toBeInstanceOf(GetItemCommand);
    expect(read.input.ConsistentRead).toBe(true);
  }
});
it('fails closed on legacy pending records without binding/version metadata', async () => {
  const read = vi
    .fn()
    .mockResolvedValueOnce({
      householdId: 'home',
      memberId: 'member',
      username: 'pending',
      role: 'parent',
      activationState: 'PENDING_ACTIVATION',
    })
    .mockResolvedValueOnce({
      sub: 'sub',
      memberId: 'member',
      username: 'pending',
      role: 'parent',
      activationState: 'PENDING_ACTIVATION',
    })
    .mockResolvedValueOnce({ householdId: 'home' });
  const transact = vi.fn();
  await expect(
    new PendingParentRepository({ read, transact }).context('sub'),
  ).rejects.toMatchObject({ kind: 'unavailable' });
  expect(transact).not.toHaveBeenCalled();
});
