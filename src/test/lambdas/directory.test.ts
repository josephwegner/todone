import { Capability } from '../../../shared/authorizationCapabilities';
import { describe, expect, it } from 'vitest';
import { directoryForCaller } from '../../../lambdas/households/directory';
import type { CurrentMembership, FamilyDirectoryMember } from '../../../lambdas/households/model';

const parent: CurrentMembership = {
  memberId: 'parent',
  username: 'parent',
  role: 'parent',
  household: { householdId: 'house', name: 'River House', timezone: 'America/Chicago' },
};
const child: CurrentMembership = { ...parent, memberId: 'child', username: 'child', role: 'child' };
const members: FamilyDirectoryMember[] = [
  {
    memberId: 'active',
    username: 'active',
    role: 'child',
    activationState: 'ACTIVE',
    displayName: 'Active Child',
    color: 'PINE',
  },
  {
    memberId: 'pending',
    username: 'pending',
    role: 'parent',
    activationState: 'PENDING_ACTIVATION',
    displayName: 'Pending Parent',
    color: 'LAKE',
  },
  {
    memberId: 'inactive',
    username: 'inactive',
    role: 'child',
    activationState: 'INACTIVE',
    displayName: 'Inactive Child',
    color: 'DUSK',
  },
];

describe('family directory visibility', () => {
  it('gives active parents the three pending-parent actions but never returns inactive members', () => {
    expect(directoryForCaller(parent, members)).toEqual([
      expect.objectContaining({
        memberId: 'active',
        allowedActions: [Capability.childPasswordReset, Capability.childRemove],
      }),
      expect.objectContaining({
        memberId: 'pending',
        allowedActions: [
          Capability.pendingParentCancel,
          Capability.pendingParentEmail,
          Capability.pendingParentResend,
        ],
      }),
    ]);
  });

  it('returns active members only to a child', () => {
    expect(directoryForCaller(child, members)).toEqual([
      expect.objectContaining({ memberId: 'active', allowedActions: [] }),
    ]);
  });
});

import { DynamoHouseholdRepository } from '../../../lambdas/households/repository';
import { QueryCommand, GetItemCommand, type DynamoDBClient } from '@aws-sdk/client-dynamodb';
it('reads every strongly consistent directory page so removal can find every parent replay partition', async () => {
  const cursor = { pk: { S: 'HOUSEHOLD#home' }, sk: { S: 'MEMBER#one' } };
  const queries: QueryCommand[] = [];
  const client = {
    async send(command: unknown) {
      if (command instanceof QueryCommand) {
        queries.push(command);
        const id = queries.length === 1 ? 'one' : 'two';
        return {
          Items: [
            {
              memberId: { S: id },
              username: { S: `parent-${id}` },
              role: { S: 'parent' },
              activationState: { S: 'ACTIVE' },
            },
          ],
          ...(queries.length === 1 ? { LastEvaluatedKey: cursor } : {}),
        };
      }
      if (command instanceof GetItemCommand) {
        const id = command.input.Key!.sk!.S!.replace('PROFILE#', '');
        return {
          Item: {
            memberId: { S: id },
            displayName: { S: id },
            color: { S: 'PINE' },
            version: { N: '1' },
          },
        };
      }
      throw new Error('Unexpected command');
    },
  };
  const members = await new DynamoHouseholdRepository(
    'table',
    client as unknown as DynamoDBClient,
  ).listFamilyMembers('home');
  expect(members.map((m) => m.memberId)).toEqual(['one', 'two']);
  expect(queries).toHaveLength(2);
  expect(queries[1]!.input.ExclusiveStartKey).toEqual(cursor);
  expect(queries.every((query) => query.input.ConsistentRead === true)).toBe(true);
});
it.each(['PENDING_ACTIVATION', 'ACTIVE'] as const)(
  'lists a %s parent without inventing a profile',
  async (activationState) => {
    const client = {
      async send(command: unknown) {
        if (command instanceof QueryCommand)
          return {
            Items: [
              {
                memberId: { S: 'new-parent' },
                username: { S: 'new-parent' },
                role: { S: 'parent' },
                activationState: { S: activationState },
              },
            ],
          };
        if (command instanceof GetItemCommand) return {};
        throw new Error('Unexpected command');
      },
    };
    const repository = new DynamoHouseholdRepository('table', client as unknown as DynamoDBClient);
    expect(await repository.listFamilyMembers('home')).toEqual([
      { memberId: 'new-parent', username: 'new-parent', role: 'parent', activationState },
    ]);
  },
);
it('continues rejecting a child directory entry with missing Profile data', async () => {
  const client = {
    async send(command: unknown) {
      if (command instanceof QueryCommand)
        return {
          Items: [
            {
              memberId: { S: 'child' },
              username: { S: 'child' },
              role: { S: 'child' },
              activationState: { S: 'ACTIVE' },
            },
          ],
        };
      if (command instanceof GetItemCommand) return {};
      throw new Error('Unexpected command');
    },
  };
  await expect(
    new DynamoHouseholdRepository('table', client as unknown as DynamoDBClient).listFamilyMembers(
      'home',
    ),
  ).rejects.toThrow();
});
