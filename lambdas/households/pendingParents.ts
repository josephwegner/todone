import { HouseholdRole, MembershipActivationState } from './constants';
import { revocationKey, revocationExpiry } from './revocation';
import { createHash, randomUUID } from 'node:crypto';
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  TransactionCanceledException,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  householdKey,
  householdMemberKey,
  membershipLookupKey,
  profileKey,
  type HouseholdStorageKey,
} from './keys';
import type { CurrentMembership, FamilyDirectoryMember } from './model';

export type HouseholdRecordValue = Record<string, string | number>;
export interface ConditionalRecordWrite {
  key: HouseholdStorageKey;
  /** undefined means the field must be absent. */
  expected: Record<string, string | number | undefined>;
  put?: HouseholdRecordValue;
  set?: HouseholdRecordValue;
  remove?: string[];
  delete?: boolean;
}
export interface ConditionalRecordStore {
  read(key: HouseholdStorageKey): Promise<HouseholdRecordValue | null>;
  transact(writes: ConditionalRecordWrite[]): Promise<boolean>;
  query?(pk: string, prefix: string): Promise<HouseholdRecordValue[]>;
}
const INTERNAL_PENDING_RECORD = 'PENDING_PARENT_RECORD_INVALID';
export const PendingParentOutcome = {
  conflict: 'conflict',
  unavailable: 'unavailable',
  unproven: 'unproven',
} as const;
export class PendingParentFailure extends Error {
  constructor(readonly kind: (typeof PendingParentOutcome)[keyof typeof PendingParentOutcome]) {
    super(kind);
  }
}
export interface ParentProvisionInput {
  callerSub: string;
  householdId: string;
  username: string;
  email: string;
  idempotencyKey: string;
}
export interface PendingParentContext {
  sub: string;
  householdId: string;
  memberId: string;
  username: string;
  salt: string;
  digest: string;
  version: number;
}
export interface PendingReplay {
  callerSub: string;
  route: string;
  target: string;
  key: string;
  digest: string;
}
export const PendingParentRoute = {
  create: '/api/v1/family-members/parents',
  activation: '/api/v1/parent-activations',
  resend: '/api/v1/family-members/{memberId}/welcome-email-resends',
  email: '/api/v1/family-members/{memberId}/pending-email',
  cancel: '/api/v1/family-members/{memberId}/pending-account',
} as const;
function replayKey(
  replay: Pick<PendingReplay, 'callerSub' | 'route' | 'key'>,
): HouseholdStorageKey {
  return {
    pk: membershipLookupKey(replay.callerSub).pk,
    sk: `IDEMPOTENCY#PARENT#${digestInput(replay.route, replay.key)}`,
  };
}
export function digestInput(...values: string[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
export function emailBinding(email: string, salt = randomUUID()) {
  return { salt, digest: digestInput(salt, email) };
}
export function proofMatches(
  context: PendingParentContext,
  email: unknown,
  verified: unknown,
): boolean {
  return (
    verified === true &&
    typeof email === 'string' &&
    digestInput(context.salt, email) === context.digest
  );
}
export class PendingParentRepository {
  constructor(
    private readonly store: ConditionalRecordStore,
    private readonly id = randomUUID,
  ) {}
  async replay(input: PendingReplay): Promise<HouseholdRecordValue | null> {
    const row = await this.store.read(replayKey(input));
    if (!row) return null;
    if (row.digest !== input.digest || row.target !== input.target)
      throw new PendingParentFailure('conflict');
    return row;
  }
  provisionReplay(input: ParentProvisionInput): PendingReplay {
    return {
      callerSub: input.callerSub,
      route: PendingParentRoute.create,
      target: input.householdId,
      key: input.idempotencyKey,
      digest: digestInput(input.householdId, input.username, input.email),
    };
  }
  async provision(input: ParentProvisionInput, sub: string): Promise<FamilyDirectoryMember> {
    const replay = this.provisionReplay(input);
    const memberId = this.id();
    const binding = emailBinding(input.email);
    const createdAt = new Date().toISOString();
    const shared = {
      memberId,
      username: input.username,
      role: HouseholdRole.parent,
      activationState: MembershipActivationState.pendingActivation,
      pendingVersion: 1,
      createdAt,
    };
    const ok = await this.store.transact([
      {
        key: membershipLookupKey(sub),
        expected: { pk: undefined },
        put: {
          ...shared,
          householdId: input.householdId,
          emailBindingSalt: binding.salt,
          emailBindingDigest: binding.digest,
        },
      },
      {
        key: householdMemberKey(input.householdId, memberId),
        expected: { pk: undefined },
        put: { ...shared, sub, householdId: input.householdId },
      },
      {
        key: replayKey(replay),
        expected: { pk: undefined },
        put: { digest: replay.digest, target: replay.target, memberId },
      },
    ]);
    if (!ok) throw new PendingParentFailure('conflict');
    return {
      memberId,
      username: input.username,
      role: HouseholdRole.parent,
      activationState: MembershipActivationState.pendingActivation,
    };
  }
  async context(sub: string): Promise<PendingParentContext> {
    const lookup = await this.store.read(membershipLookupKey(sub));
    if (
      !lookup ||
      lookup.role !== HouseholdRole.parent ||
      lookup.activationState !== MembershipActivationState.pendingActivation
    )
      throw new PendingParentFailure('unavailable');
    const householdId = requiredString(lookup.householdId),
      memberId = requiredString(lookup.memberId);
    const member = await this.store.read(householdMemberKey(householdId, memberId));
    const household = await this.store.read(householdKey(householdId));
    const version = lookup.pendingVersion;
    if (
      !member ||
      !household ||
      household.householdId !== householdId ||
      member.memberId !== memberId ||
      member.sub !== sub ||
      member.username !== lookup.username ||
      member.role !== lookup.role ||
      member.activationState !== lookup.activationState ||
      member.pendingVersion !== version ||
      typeof version !== 'number' ||
      !Number.isSafeInteger(version) ||
      version < 1
    )
      throw new PendingParentFailure('unavailable');
    return {
      sub,
      householdId,
      memberId,
      username: requiredString(lookup.username),
      salt: requiredString(lookup.emailBindingSalt),
      digest: requiredString(lookup.emailBindingDigest),
      version,
    };
  }
  private conditions(
    context: PendingParentContext,
    owner: string | undefined,
  ): ConditionalRecordWrite[] {
    const shared = {
      memberId: context.memberId,
      username: context.username,
      role: HouseholdRole.parent,
      activationState: MembershipActivationState.pendingActivation,
      pendingVersion: context.version,
    };
    return [
      {
        key: membershipLookupKey(context.sub),
        expected: {
          ...shared,
          householdId: context.householdId,
          pendingOperationOwner: owner,
          emailBindingSalt: context.salt,
          emailBindingDigest: context.digest,
        },
      },
      {
        key: householdMemberKey(context.householdId, context.memberId),
        expected: { ...shared, sub: context.sub },
      },
    ];
  }
  async acquire(context: PendingParentContext, owner: string): Promise<void> {
    const writes = this.conditions(context, undefined);
    writes[0]!.set = { pendingOperationOwner: owner };
    if (!(await this.store.transact(writes))) throw new PendingParentFailure('conflict');
    // A strong read under ownership catches malformed/missing target invariants before Cognito.
    const current = await this.context(context.sub);
    if (current.version !== context.version || current.digest !== context.digest)
      throw new PendingParentFailure('conflict');
  }
  async release(context: PendingParentContext, owner: string): Promise<void> {
    const writes = this.conditions(context, owner);
    writes[0]!.remove = ['pendingOperationOwner'];
    if (!(await this.store.transact(writes))) throw new PendingParentFailure('conflict');
  }
  async activate(context: PendingParentContext, owner: string): Promise<CurrentMembership> {
    const household = await this.store.read(householdKey(context.householdId));
    if (!household) throw new Error(INTERNAL_PENDING_RECORD);
    const writes = this.conditions(context, owner);
    writes[0]!.set = { activationState: MembershipActivationState.active };
    writes[0]!.remove = [
      'pendingOperationOwner',
      'pendingVersion',
      'emailBindingSalt',
      'emailBindingDigest',
    ];
    writes[1]!.set = { activationState: MembershipActivationState.active };
    writes[1]!.remove = ['pendingVersion'];
    if (!(await this.store.transact(writes))) throw new PendingParentFailure('conflict');
    return {
      memberId: context.memberId,
      username: context.username,
      role: HouseholdRole.parent,
      household: {
        householdId: context.householdId,
        name: requiredString(household.name),
        timezone: requiredString(household.timezone),
      },
    };
  }
  async finish(
    context: PendingParentContext,
    owner: string,
    replay: PendingReplay,
    action: 'resend' | 'email' | 'cancel',
    email?: string,
  ): Promise<void> {
    const writes = this.conditions(context, owner);
    if (action === 'cancel') {
      writes.push({
        key: revocationKey(context.sub),
        expected: { pk: undefined },
        put: { expiresAt: revocationExpiry() },
      });
      writes[0]!.delete = true;
      writes[1]!.delete = true;
      const profile = await this.store.read(profileKey(context.householdId, context.memberId));
      writes.push({
        key: profileKey(context.householdId, context.memberId),
        expected: profile ? { memberId: context.memberId } : { pk: undefined },
        delete: true,
      });
    } else {
      writes[0]!.remove = ['pendingOperationOwner'];
      if (action === 'email') {
        if (!email) throw new Error(INTERNAL_PENDING_RECORD);
        const binding = emailBinding(email);
        writes[0]!.set = {
          emailBindingSalt: binding.salt,
          emailBindingDigest: binding.digest,
          pendingVersion: context.version + 1,
        };
        writes[1]!.set = { pendingVersion: context.version + 1 };
      }
    }
    writes.push({
      key: replayKey(replay),
      expected: { pk: undefined },
      put: { digest: replay.digest, target: replay.target },
    });
    if (!(await this.store.transact(writes))) throw new PendingParentFailure('conflict');
  }
}
function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new PendingParentFailure('unavailable');
  return value;
}

/** DynamoDB condition checks and ownership publication share one transaction across Lambda instances. */
export class DynamoConditionalRecordStore implements ConditionalRecordStore {
  constructor(
    private readonly tableName: string,
    private readonly client: DynamoDBClient,
  ) {}
  async read(key: HouseholdStorageKey): Promise<HouseholdRecordValue | null> {
    const result = await this.client.send(
      new GetItemCommand({ TableName: this.tableName, Key: attributes(key), ConsistentRead: true }),
    );
    if (!result.Item) return null;
    return Object.fromEntries(
      Object.entries(result.Item)
        .filter(([, v]) => v.S !== undefined || v.N !== undefined)
        .map(([k, v]) => [k, v.S ?? Number(v.N)]),
    );
  }
  async query(pk: string, prefix: string): Promise<HouseholdRecordValue[]> {
    const rows: HouseholdRecordValue[] = [];
    let last: Record<string, AttributeValue> | undefined;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
          ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk' },
          ExpressionAttributeValues: { ':pk': { S: pk }, ':prefix': { S: prefix } },
          ConsistentRead: true,
          ...(last ? { ExclusiveStartKey: last } : {}),
        }),
      );
      for (const row of result.Items ?? [])
        rows.push(
          Object.fromEntries(
            Object.entries(row)
              .filter(([, v]) => v.S !== undefined || v.N !== undefined)
              .map(([k, v]) => [k, v.S ?? Number(v.N)]),
          ),
        );
      last = result.LastEvaluatedKey;
    } while (last);
    return rows;
  }
  async transact(writes: ConditionalRecordWrite[]): Promise<boolean> {
    try {
      await this.client.send(
        new TransactWriteItemsCommand({
          TransactItems: writes.map((write) => {
            const names: Record<string, string> = {},
              values: Record<string, AttributeValue> = {};
            const conditions = Object.entries(write.expected).map(([field, value], index) => {
              const name = `#c${index}`;
              names[name] = field;
              if (value === undefined) return `attribute_not_exists(${name})`;
              const ref = `:c${index}`;
              values[ref] = attribute(value);
              return `${name} = ${ref}`;
            });
            const common = {
              TableName: this.tableName,
              ConditionExpression: conditions.join(' AND '),
              ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
              ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
            };
            if (write.put)
              return { Put: { ...common, Item: attributes({ ...write.key, ...write.put }) } };
            if (write.delete) return { Delete: { ...common, Key: attributes(write.key) } };
            if (!write.set && !write.remove)
              return { ConditionCheck: { ...common, Key: attributes(write.key) } };
            const updates: string[] = [];
            if (write.set)
              updates.push(
                'SET ' +
                  Object.entries(write.set)
                    .map(([k, v], i) => {
                      names[`#s${i}`] = k;
                      values[`:s${i}`] = attribute(v);
                      return `#s${i} = :s${i}`;
                    })
                    .join(', '),
              );
            if (write.remove)
              updates.push(
                'REMOVE ' +
                  write.remove
                    .map((k, i) => {
                      names[`#r${i}`] = k;
                      return `#r${i}`;
                    })
                    .join(', '),
              );
            return {
              Update: {
                ...common,
                Key: attributes(write.key),
                UpdateExpression: updates.join(' '),
                ExpressionAttributeNames: names,
                ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
              },
            };
          }),
        }),
      );
      return true;
    } catch (error) {
      if (
        error instanceof TransactionCanceledException &&
        error.CancellationReasons?.some((reason) => reason.Code === 'ConditionalCheckFailed')
      )
        return false;
      throw error;
    }
  }
}
function attribute(value: string | number): AttributeValue {
  return typeof value === 'number' ? { N: String(value) } : { S: value };
}
function attributes(value: object): Record<string, AttributeValue> {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, attribute(v)]));
}
