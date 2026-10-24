import { ChildRemovalRepository } from './childRemoval';
import { isRevoked, revocationKey } from './revocation';
import {
  PendingParentRepository,
  DynamoConditionalRecordStore,
  type ConditionalRecordStore,
  type HouseholdRecordValue,
} from './pendingParents';
import { createHash, randomUUID } from 'node:crypto';
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  UpdateItemCommand,
  TransactWriteItemsCommand,
  ConditionalCheckFailedException,
  TransactionCanceledException,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  ATTRIBUTE_DOES_NOT_EXIST,
  HouseholdRecord,
  HouseholdRole,
  INITIAL_HOUSEHOLD_VERSION,
  INITIAL_PROFILE_VERSION,
  MembershipActivationState,
  MembershipResolutionKind,
  ProfileColor,
} from './constants';
import {
  bootstrapReplayKey,
  childProvisionReplayKey,
  householdKey,
  householdMemberKey,
  inMemoryReplayKey,
  membershipLookupKey,
  profileKey,
  type HouseholdStorageKey,
} from './keys';
import type {
  BootstrapInput,
  BootstrapResult,
  ProvisionChildInput,
  ProvisionChildResult,
  CurrentMembership,
  FamilyDirectoryMember,
  Household,
  HouseholdMemberTarget,
  HouseholdRepository,
  Membership,
  MembershipActivationState as MembershipActivationStateValue,
  MembershipLookup,
  MembershipResolution,
  MembershipRole,
  Profile,
  SaveProfileInput,
  SaveProfileResult,
} from './model';

export class DynamoHouseholdRepository implements HouseholdRepository {
  private get recordStore(): ConditionalRecordStore {
    return new DynamoConditionalRecordStore(this.tableName, this.client);
  }
  get pendingParents(): PendingParentRepository {
    return new PendingParentRepository(this.recordStore, this.id);
  }
  get childRemoval(): ChildRemovalRepository {
    return new ChildRemovalRepository(this.recordStore);
  }

  constructor(
    private readonly tableName: string,
    private readonly client = new DynamoDBClient({}),
    private readonly now = () => new Date(),
    private readonly id = randomUUID,
  ) {}

  async resolveMembership(sub: string, tokenIssuedAt?: number): Promise<MembershipResolution> {
    try {
      if (await isRevoked(this.recordStore, sub))
        return { kind: MembershipResolutionKind.inactive };
      const lookup = await this.getItem(membershipLookupKey(sub));
      if (!lookup) {
        if (await isRevoked(this.recordStore, sub))
          return { kind: MembershipResolutionKind.inactive };
        return { kind: MembershipResolutionKind.unattached };
      }
      const householdId = requiredStringAttribute(lookup.householdId);
      const memberId = requiredStringAttribute(lookup.memberId);
      const [household, membership] = await Promise.all([
        this.getItem(householdKey(householdId)),
        this.getItem(householdMemberKey(householdId, memberId)),
      ]);
      if (!household || !membership) return { kind: MembershipResolutionKind.inconsistent };
      return membershipResolutionFromStoredItems(lookup, membership, household, sub, tokenIssuedAt);
    } catch {
      return { kind: MembershipResolutionKind.inconsistent };
    }
  }

  async bootstrap(input: BootstrapInput): Promise<BootstrapResult> {
    if (await isRevoked(this.recordStore, input.sub)) return { kind: 'already-member' };
    const inputHash = hashInput(input.name, input.timezone, input.username);
    const replay = await this.readReplay(input.sub, input.idempotencyKey, inputHash);
    if (replay) return replay;

    const householdId = this.id();
    const memberId = this.id();
    const createdAt = this.now().toISOString();
    const membership = currentMembership({
      householdId,
      memberId,
      name: input.name,
      timezone: input.timezone,
      username: input.username,
    });
    try {
      await this.client.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: this.tableName,
                Key: {
                  pk: stringAttribute(revocationKey(input.sub).pk),
                  sk: stringAttribute(revocationKey(input.sub).sk),
                },
                ConditionExpression: ATTRIBUTE_DOES_NOT_EXIST,
              },
            },
            putItem(
              this.tableName,
              membershipLookupItem(input.sub, input.username, householdId, memberId, createdAt),
              ATTRIBUTE_DOES_NOT_EXIST,
            ),
            putItem(this.tableName, householdItem(householdId, input, createdAt)),
            putItem(
              this.tableName,
              householdMemberItem(householdId, memberId, input.sub, input.username, createdAt),
            ),
            putItem(
              this.tableName,
              bootstrapReplayItem(input, inputHash, householdId, memberId),
              ATTRIBUTE_DOES_NOT_EXIST,
            ),
          ],
        }),
      );
      return { kind: 'created', membership };
    } catch (error) {
      if (!(error instanceof TransactionCanceledException)) throw error;
      const replayAfterConflict = await this.readReplay(input.sub, input.idempotencyKey, inputHash);
      if (replayAfterConflict) return replayAfterConflict;
      return (await this.resolveMembership(input.sub)).kind === MembershipResolutionKind.unattached
        ? { kind: 'idempotency-conflict' }
        : { kind: 'already-member' };
    }
  }

  async getProfile(householdId: string, memberId: string): Promise<Profile | null> {
    const item = await this.getItem(profileKey(householdId, memberId));
    return item ? profileFromItem(item) : null;
  }

  async saveProfile(input: SaveProfileInput): Promise<SaveProfileResult> {
    const existing = await this.getProfile(input.householdId, input.memberId);
    if (existing && existing.version !== input.version)
      return { kind: 'conflict', profile: existing };
    if (!existing && input.version !== 0) return { kind: 'conflict', profile: null };

    const nextProfile: Profile = {
      memberId: input.memberId,
      displayName: input.displayName,
      color: input.color,
      version: existing ? existing.version + 1 : INITIAL_PROFILE_VERSION,
    };
    try {
      await this.client.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: this.tableName,
                Key: {
                  pk: stringAttribute(householdMemberKey(input.householdId, input.memberId).pk),
                  sk: stringAttribute(householdMemberKey(input.householdId, input.memberId).sk),
                },
                ConditionExpression: '#state = :active',
                ExpressionAttributeNames: { '#state': 'activationState' },
                ExpressionAttributeValues: {
                  ':active': stringAttribute(MembershipActivationState.active),
                },
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: profileItem(input.householdId, nextProfile),
                ConditionExpression: existing
                  ? '#version = :expectedVersion'
                  : ATTRIBUTE_DOES_NOT_EXIST,
                ...(existing
                  ? {
                      ExpressionAttributeNames: { '#version': 'version' },
                      ExpressionAttributeValues: {
                        ':expectedVersion': numberAttribute(input.version),
                      },
                    }
                  : {}),
              },
            },
          ],
        }),
      );
      return { kind: existing ? 'updated' : 'created', profile: nextProfile };
    } catch (error) {
      if (!(error instanceof TransactionCanceledException)) throw error;
      return {
        kind: 'conflict',
        profile: await this.getProfile(input.householdId, input.memberId),
      };
    }
  }

  async listFamilyMembers(householdId: string): Promise<FamilyDirectoryMember[]> {
    const key = householdKey(householdId);
    const memberships: Record<string, AttributeValue>[] = [];
    let cursor: Record<string, AttributeValue> | undefined;
    do {
      const result = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :memberPrefix)',
          ExpressionAttributeValues: {
            ':pk': stringAttribute(key.pk),
            ':memberPrefix': stringAttribute(`${HouseholdRecord.memberPrefix}#`),
          },
          ConsistentRead: true,
          ExclusiveStartKey: cursor,
        }),
      );
      memberships.push(...(result.Items ?? []).filter(isVisibleDirectoryMembership));
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    const members = await Promise.all(
      memberships.map(async (membership) => {
        const memberId = requiredStringAttribute(membership.memberId);
        const profile = await this.getProfile(householdId, memberId);
        return directoryMemberFromStoredItem(membership, profile);
      }),
    );
    return sortDirectoryMembers(members);
  }

  async getHouseholdMemberTarget(
    householdId: string,
    memberId: string,
  ): Promise<HouseholdMemberTarget | null> {
    const item = await this.getItem(householdMemberKey(householdId, memberId));
    if (!item) return null;
    const target = householdMemberTargetFromItem(item);
    const lookup = await this.getItem(membershipLookupKey(target.sub));
    if (
      !lookup ||
      requiredStringAttribute(lookup.householdId) !== householdId ||
      requiredStringAttribute(lookup.memberId) !== memberId ||
      target.memberId !== memberId ||
      requiredStringAttribute(lookup.username) !== target.username ||
      requiredMembershipRole(lookup.role) !== target.role ||
      requiredActivationState(lookup.activationState) !== target.activationState
    )
      throw new Error('Member target lookup is inconsistent.');
    return target;
  }

  async advanceCredentialsValidAfter(sub: string, cutoff: string): Promise<void> {
    const key = membershipLookupKey(sub);
    try {
      await this.client.send(
        new UpdateItemCommand({
          TableName: this.tableName,
          Key: { pk: stringAttribute(key.pk), sk: stringAttribute(key.sk) },
          UpdateExpression: 'SET #credentialsValidAfter = :cutoff',
          ConditionExpression:
            'attribute_exists(pk) AND (attribute_not_exists(#credentialsValidAfter) OR #credentialsValidAfter < :cutoff)',
          ExpressionAttributeNames: { '#credentialsValidAfter': 'credentialsValidAfter' },
          ExpressionAttributeValues: { ':cutoff': stringAttribute(cutoff) },
        }),
      );
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
      const lookup = await this.getItem(key);
      if (!lookup || requiredStringAttribute(lookup.credentialsValidAfter) < cutoff)
        throw new Error('Credential cutoff could not be confirmed.', { cause: error });
    }
  }

  async findChildProvisionReplay(
    input: Omit<ProvisionChildInput, 'childSub'>,
  ): Promise<ProvisionChildResult | null> {
    const replay = await this.getItem(
      childProvisionReplayKey(input.callerSub, input.idempotencyKey),
    );
    if (!replay) return null;
    const inputHash = hashInput(input.username, input.displayName, input.color);
    if (requiredStringAttribute(replay.inputHash) !== inputHash)
      return { kind: 'idempotency-conflict' };
    const memberId = requiredStringAttribute(replay.memberId);
    const membership = await this.getItem(householdMemberKey(input.householdId, memberId));
    const profile = await this.getProfile(input.householdId, memberId);
    if (!membership || !profile) throw new Error('Child provisioning replay is inconsistent.');
    return { kind: 'replayed', member: directoryMemberFromStoredItem(membership, profile) };
  }

  async provisionChild(input: ProvisionChildInput): Promise<ProvisionChildResult> {
    const inputHash = hashInput(input.username, input.displayName, input.color);
    const existing = await this.findChildProvisionReplay(input);
    if (existing) return existing;
    const memberId = this.id();
    const createdAt = this.now().toISOString();
    const member: Membership = {
      householdId: input.householdId,
      memberId,
      sub: input.childSub,
      username: input.username,
      role: HouseholdRole.child,
      activationState: MembershipActivationState.active,
      createdAt,
    };
    const profile: Profile = {
      memberId,
      displayName: input.displayName,
      color: input.color,
      version: INITIAL_PROFILE_VERSION,
    };
    try {
      await this.client.send(
        new TransactWriteItemsCommand({
          TransactItems: [
            putItem(
              this.tableName,
              membershipLookupItem(
                input.childSub,
                input.username,
                input.householdId,
                memberId,
                createdAt,
                HouseholdRole.child,
              ),
              ATTRIBUTE_DOES_NOT_EXIST,
            ),
            putItem(
              this.tableName,
              householdMemberItem(
                input.householdId,
                memberId,
                input.childSub,
                input.username,
                createdAt,
                HouseholdRole.child,
              ),
            ),
            putItem(
              this.tableName,
              profileItem(input.householdId, profile),
              ATTRIBUTE_DOES_NOT_EXIST,
            ),
            putItem(
              this.tableName,
              childReplayItem(input.callerSub, input.idempotencyKey, inputHash, memberId),
              ATTRIBUTE_DOES_NOT_EXIST,
            ),
          ],
        }),
      );
      return { kind: 'created', member: directoryMemberFromMembership(member, profile) };
    } catch (error) {
      if (!(error instanceof TransactionCanceledException)) throw error;
      const replay = await this.findChildProvisionReplay(input);
      if (replay) return replay;
      throw error;
    }
  }

  private async readReplay(
    sub: string,
    idempotencyKey: string,
    inputHash: string,
  ): Promise<BootstrapResult | null> {
    const item = await this.getItem(bootstrapReplayKey(sub, idempotencyKey));
    if (!item) return null;
    if (requiredStringAttribute(item.inputHash) !== inputHash)
      return { kind: 'idempotency-conflict' };
    return { kind: 'replayed', membership: membershipFromReplayItem(item) };
  }

  private async getItem(key: HouseholdStorageKey): Promise<Record<string, AttributeValue> | null> {
    const result = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { pk: stringAttribute(key.pk), sk: stringAttribute(key.sk) },
        ConsistentRead: true,
      }),
    );
    return result.Item ?? null;
  }
}

export class InMemoryHouseholdRepository implements HouseholdRepository {
  private readonly pendingRows = new Map<string, HouseholdRecordValue>();
  get pendingParents(): PendingParentRepository {
    return new PendingParentRepository(this.recordStore, this.id);
  }
  get childRemoval(): ChildRemovalRepository {
    return new ChildRemovalRepository(this.recordStore);
  }
  private get recordStore(): ConditionalRecordStore {
    const read = (key: HouseholdStorageKey): HouseholdRecordValue | null => {
      const row = this.pendingMemoryMap(key).get(this.pendingMemoryKey(key));
      return row ? (structuredClone({ ...key, ...row }) as HouseholdRecordValue) : null;
    };
    const store: ConditionalRecordStore = {
      read: async (key) => read(key),
      query: async (pk, prefix) => {
        const rows: HouseholdRecordValue[] = [];
        for (const [key, value] of this.childReplays) {
          const split = key.indexOf('\0');
          const sub = key.slice(0, split),
            local = key.slice(split + 1);
          if (!local.startsWith('CHILD:')) continue;
          const raw = childProvisionReplayKey(sub, local.slice(6));
          if (raw.pk === pk && raw.sk.startsWith(prefix)) rows.push({ ...raw, ...value });
        }
        for (const value of this.pendingRows.values())
          if (value.pk === pk && typeof value.sk === 'string' && value.sk.startsWith(prefix))
            rows.push(structuredClone(value));
        return rows;
      },
      transact: async (writes) => {
        // Synchronous check-then-commit is atomic across concurrent local requests, with no await gap.
        if (
          writes.some((write) =>
            Object.entries(write.expected).some(
              ([name, value]) => read(write.key)?.[name] !== value,
            ),
          )
        )
          return false;
        for (const write of writes) {
          const map = this.pendingMemoryMap(write.key),
            key = this.pendingMemoryKey(write.key);
          if (write.delete) {
            map.delete(key);
            continue;
          }
          if (!write.put && !write.set && !write.remove) continue;
          const row = { ...(write.put ?? read(write.key) ?? {}), ...write.set };
          for (const name of [...(write.remove ?? []), 'pk', 'sk']) delete row[name];
          map.set(key, structuredClone(row));
        }
        return true;
      },
    };
    return store;
  }
  private pendingMemoryKey(key: HouseholdStorageKey): string {
    const id = key.pk.slice(key.pk.indexOf('#') + 1);
    if (key.sk.startsWith('IDEMPOTENCY#CHILD#'))
      return inMemoryReplayKey(id, `CHILD:${key.sk.slice('IDEMPOTENCY#CHILD#'.length)}`);
    if (key.sk === HouseholdRecord.membership || key.sk === HouseholdRecord.household) return id;
    if (key.sk.startsWith('MEMBER#') || key.sk.startsWith('PROFILE#'))
      return `${id}\0${key.sk.slice(key.sk.indexOf('#') + 1)}`;
    return `${key.pk}\0${key.sk}`;
  }
  private pendingMemoryMap(key: HouseholdStorageKey): Map<string, HouseholdRecordValue> {
    let map: Map<string, unknown>;
    if (key.sk.startsWith('IDEMPOTENCY#CHILD#')) map = this.childReplays;
    else if (key.sk === HouseholdRecord.membership) map = this.lookups;
    else if (key.sk === HouseholdRecord.household) map = this.households;
    else if (key.sk.startsWith('MEMBER#')) map = this.memberships;
    else if (key.sk.startsWith('PROFILE#')) map = this.profiles;
    else map = this.pendingRows;
    return map as Map<string, HouseholdRecordValue>;
  }

  private readonly lookups = new Map<string, MembershipLookup>();
  private readonly households = new Map<string, Household>();
  private readonly memberships = new Map<string, Membership>();
  private readonly replays = new Map<string, { hash: string; membership: CurrentMembership }>();
  private readonly profiles = new Map<string, Profile>();
  private readonly childReplays = new Map<string, { hash: string; memberId: string }>();
  constructor(private readonly id = randomUUID) {}

  async resolveMembership(sub: string, tokenIssuedAt?: number): Promise<MembershipResolution> {
    if (await isRevoked(this.recordStore, sub)) return { kind: MembershipResolutionKind.inactive };
    const lookup = this.lookups.get(sub);
    if (!lookup) {
      if (await isRevoked(this.recordStore, sub))
        return { kind: MembershipResolutionKind.inactive };
      return { kind: MembershipResolutionKind.unattached };
    }
    const household = this.households.get(lookup.householdId);
    const membership = this.memberships.get(
      membershipStorageKey(lookup.householdId, lookup.memberId),
    );
    if (!household || !membership) return { kind: MembershipResolutionKind.inconsistent };
    return resolveMembershipRecords(lookup, membership, household, sub, tokenIssuedAt);
  }

  async bootstrap(input: BootstrapInput): Promise<BootstrapResult> {
    if (await isRevoked(this.recordStore, input.sub)) return { kind: 'already-member' };
    const replayKey = inMemoryReplayKey(input.sub, input.idempotencyKey);
    const inputHash = hashInput(input.name, input.timezone, input.username);
    const replay = this.replays.get(replayKey);
    if (replay) {
      return replay.hash === inputHash
        ? { kind: 'replayed', membership: structuredClone(replay.membership) }
        : { kind: 'idempotency-conflict' };
    }
    const blocked = revocationKey(input.sub);
    if (this.lookups.has(input.sub) || this.pendingRows.has(`${blocked.pk}\0${blocked.sk}`))
      return { kind: 'already-member' };

    const householdId = this.id();
    const memberId = this.id();
    const createdAt = new Date(0).toISOString();
    const membership = currentMembership({
      memberId,
      householdId,
      name: input.name,
      timezone: input.timezone,
      username: input.username,
    });
    this.lookups.set(input.sub, {
      householdId,
      memberId,
      username: input.username,
      role: HouseholdRole.parent,
      activationState: MembershipActivationState.active,
      createdAt,
    });
    this.households.set(householdId, {
      householdId,
      name: input.name,
      timezone: input.timezone,
      createdAt,
      version: INITIAL_HOUSEHOLD_VERSION,
    });
    this.memberships.set(membershipStorageKey(householdId, memberId), {
      memberId,
      householdId,
      sub: input.sub,
      username: input.username,
      role: HouseholdRole.parent,
      activationState: MembershipActivationState.active,
      createdAt,
    });
    this.replays.set(replayKey, { hash: inputHash, membership: structuredClone(membership) });
    return { kind: 'created', membership };
  }

  async getProfile(householdId: string, memberId: string): Promise<Profile | null> {
    const profile = this.profiles.get(profileStorageKey(householdId, memberId)) ?? null;
    return cloneProfile(profile);
  }

  async saveProfile(input: SaveProfileInput): Promise<SaveProfileResult> {
    const member = this.memberships.get(membershipStorageKey(input.householdId, input.memberId));
    if (!member || member.activationState !== MembershipActivationState.active)
      return { kind: 'conflict', profile: null };
    const key = profileStorageKey(input.householdId, input.memberId);
    const existing = this.profiles.get(key) ?? null;
    if (!isExpectedProfileVersion(existing, input.version)) {
      return { kind: 'conflict', profile: cloneProfile(existing) };
    }
    const profile: Profile = {
      memberId: input.memberId,
      displayName: input.displayName,
      color: input.color,
      version: existing ? existing.version + 1 : INITIAL_PROFILE_VERSION,
    };
    this.profiles.set(key, structuredClone(profile));
    return { kind: existing ? 'updated' : 'created', profile };
  }

  async listFamilyMembers(householdId: string): Promise<FamilyDirectoryMember[]> {
    const members = [...this.memberships.values()]
      .filter((membership) => membership.householdId === householdId)
      .filter(isVisibleInMemoryDirectoryMembership);
    const directory = members.map((membership) => {
      const profile =
        this.profiles.get(profileStorageKey(householdId, membership.memberId)) ?? null;
      return directoryMemberFromMembership(membership, profile);
    });
    return sortDirectoryMembers(directory);
  }

  async getHouseholdMemberTarget(
    householdId: string,
    memberId: string,
  ): Promise<HouseholdMemberTarget | null> {
    const membership = this.memberships.get(membershipStorageKey(householdId, memberId));
    if (!membership) return null;
    const lookup = this.lookups.get(membership.sub);
    if (
      !lookup ||
      lookup.householdId !== householdId ||
      lookup.memberId !== memberId ||
      membership.memberId !== memberId ||
      lookup.username !== membership.username ||
      lookup.role !== membership.role ||
      lookup.activationState !== membership.activationState
    )
      throw new Error('Member target lookup is inconsistent.');
    return householdMemberTargetFromMembership(membership);
  }

  async advanceCredentialsValidAfter(sub: string, cutoff: string): Promise<void> {
    const lookup = this.lookups.get(sub);
    if (!lookup) throw new Error('Credential cutoff lookup does not exist.');
    if (lookup.credentialsValidAfter && lookup.credentialsValidAfter >= cutoff) return;
    lookup.credentialsValidAfter = cutoff;
  }

  async findChildProvisionReplay(
    input: Omit<ProvisionChildInput, 'childSub'>,
  ): Promise<ProvisionChildResult | null> {
    const replayKey = inMemoryReplayKey(input.callerSub, `CHILD:${input.idempotencyKey}`);
    const replay = this.childReplays.get(replayKey);
    if (!replay) return null;
    const hash = hashInput(input.username, input.displayName, input.color);
    if (replay.hash !== hash) return { kind: 'idempotency-conflict' };
    const member = this.memberships.get(membershipStorageKey(input.householdId, replay.memberId));
    const profile = this.profiles.get(profileStorageKey(input.householdId, replay.memberId));
    if (!member || !profile) throw new Error('Child provisioning replay is inconsistent.');
    return { kind: 'replayed', member: directoryMemberFromMembership(member, profile) };
  }

  async provisionChild(input: ProvisionChildInput): Promise<ProvisionChildResult> {
    const replayKey = inMemoryReplayKey(input.callerSub, `CHILD:${input.idempotencyKey}`);
    const hash = hashInput(input.username, input.displayName, input.color);
    const replay = await this.findChildProvisionReplay(input);
    if (replay) return replay;
    const memberId = this.id();
    const createdAt = new Date(0).toISOString();
    const member: Membership = {
      householdId: input.householdId,
      memberId,
      sub: input.childSub,
      username: input.username,
      role: HouseholdRole.child,
      activationState: MembershipActivationState.active,
      createdAt,
    };
    const profile: Profile = {
      memberId,
      displayName: input.displayName,
      color: input.color,
      version: INITIAL_PROFILE_VERSION,
    };
    this.lookups.set(input.childSub, {
      householdId: input.householdId,
      memberId,
      username: input.username,
      role: HouseholdRole.child,
      activationState: MembershipActivationState.active,
      createdAt,
    });
    this.memberships.set(membershipStorageKey(input.householdId, memberId), member);
    this.profiles.set(profileStorageKey(input.householdId, memberId), profile);
    this.childReplays.set(replayKey, { hash, memberId });
    return { kind: 'created', member: directoryMemberFromMembership(member, profile) };
  }
}

function currentMembership(input: {
  memberId: string;
  householdId: string;
  name: string;
  timezone: string;
  username: string;
}): CurrentMembership {
  return {
    memberId: input.memberId,
    username: input.username,
    role: HouseholdRole.parent,
    household: { householdId: input.householdId, name: input.name, timezone: input.timezone },
  };
}

function membershipLookupItem(
  sub: string,
  username: string,
  householdId: string,
  memberId: string,
  createdAt: string,
  role: MembershipRole = HouseholdRole.parent,
) {
  const key = membershipLookupKey(sub);
  return {
    pk: stringAttribute(key.pk),
    sk: stringAttribute(key.sk),
    householdId: stringAttribute(householdId),
    memberId: stringAttribute(memberId),
    username: stringAttribute(username),
    role: stringAttribute(role),
    activationState: stringAttribute(MembershipActivationState.active),
    createdAt: stringAttribute(createdAt),
  };
}

function householdItem(householdId: string, input: BootstrapInput, createdAt: string) {
  const key = householdKey(householdId);
  return {
    pk: stringAttribute(key.pk),
    sk: stringAttribute(key.sk),
    householdId: stringAttribute(householdId),
    name: stringAttribute(input.name),
    timezone: stringAttribute(input.timezone),
    createdAt: stringAttribute(createdAt),
    // Future household updates use this as their optimistic-concurrency version.
    version: numberAttribute(INITIAL_HOUSEHOLD_VERSION),
  };
}

function householdMemberItem(
  householdId: string,
  memberId: string,
  sub: string,
  username: string,
  createdAt: string,
  role: MembershipRole = HouseholdRole.parent,
) {
  const key = householdMemberKey(householdId, memberId);
  return {
    pk: stringAttribute(key.pk),
    sk: stringAttribute(key.sk),
    memberId: stringAttribute(memberId),
    sub: stringAttribute(sub),
    username: stringAttribute(username),
    role: stringAttribute(role),
    activationState: stringAttribute(MembershipActivationState.active),
    createdAt: stringAttribute(createdAt),
  };
}

function bootstrapReplayItem(
  input: BootstrapInput,
  inputHash: string,
  householdId: string,
  memberId: string,
) {
  const key = bootstrapReplayKey(input.sub, input.idempotencyKey);
  return {
    pk: stringAttribute(key.pk),
    sk: stringAttribute(key.sk),
    inputHash: stringAttribute(inputHash),
    householdId: stringAttribute(householdId),
    memberId: stringAttribute(memberId),
    name: stringAttribute(input.name),
    timezone: stringAttribute(input.timezone),
    username: stringAttribute(input.username),
  };
}

function profileItem(householdId: string, profile: Profile) {
  const key = profileKey(householdId, profile.memberId);
  return {
    pk: stringAttribute(key.pk),
    sk: stringAttribute(key.sk),
    memberId: stringAttribute(profile.memberId),
    displayName: stringAttribute(profile.displayName),
    color: stringAttribute(profile.color),
    version: numberAttribute(profile.version),
  };
}
function childReplayItem(sub: string, idempotencyKey: string, inputHash: string, memberId: string) {
  const key = childProvisionReplayKey(sub, idempotencyKey);
  return {
    pk: stringAttribute(key.pk),
    sk: stringAttribute(key.sk),
    inputHash: stringAttribute(inputHash),
    memberId: stringAttribute(memberId),
  };
}
function directoryMemberFromMembership(
  membership: Membership,
  profile: Profile | null,
): FamilyDirectoryMember {
  if (!profile && membership.role !== HouseholdRole.parent) throw missingProfileError();
  return {
    memberId: membership.memberId,
    username: membership.username,
    role: membership.role,
    activationState: membership.activationState,
    ...(profile ? { displayName: profile.displayName, color: profile.color } : {}),
  };
}

function householdMemberTargetFromMembership(membership: Membership): HouseholdMemberTarget {
  return {
    memberId: membership.memberId,
    sub: membership.sub,
    username: membership.username,
    role: membership.role,
    activationState: membership.activationState,
  };
}

function householdMemberTargetFromItem(
  membership: Record<string, AttributeValue>,
): HouseholdMemberTarget {
  return {
    memberId: requiredStringAttribute(membership.memberId),
    sub: requiredStringAttribute(membership.sub),
    username: requiredStringAttribute(membership.username),
    role: requiredMembershipRole(membership.role),
    activationState: requiredActivationState(membership.activationState),
  };
}

function membershipResolutionFromStoredItems(
  lookup: Record<string, AttributeValue>,
  membership: Record<string, AttributeValue>,
  household: Record<string, AttributeValue>,
  sub: string,
  tokenIssuedAt?: number,
): MembershipResolution {
  const lookupRecord: MembershipLookup = {
    householdId: requiredStringAttribute(lookup.householdId),
    memberId: requiredStringAttribute(lookup.memberId),
    username: requiredStringAttribute(lookup.username),
    role: requiredMembershipRole(lookup.role),
    activationState: requiredActivationState(lookup.activationState),
    ...(lookup.credentialsValidAfter
      ? { credentialsValidAfter: requiredStringAttribute(lookup.credentialsValidAfter) }
      : {}),
    ...(lookup.createdAt ? { createdAt: requiredStringAttribute(lookup.createdAt) } : {}),
  };
  const membershipRecord: AuthorizingMembershipRecord = {
    memberId: requiredStringAttribute(membership.memberId),
    sub: requiredStringAttribute(membership.sub),
    username: requiredStringAttribute(membership.username),
    role: requiredMembershipRole(membership.role),
    activationState: requiredActivationState(membership.activationState),
  };
  const householdRecord: AuthorizingHouseholdRecord = {
    householdId: requiredStringAttribute(household.householdId),
    name: requiredStringAttribute(household.name),
    timezone: requiredStringAttribute(household.timezone),
  };
  return resolveMembershipRecords(
    lookupRecord,
    membershipRecord,
    householdRecord,
    sub,
    tokenIssuedAt,
  );
}

type AuthorizingMembershipRecord = Pick<
  Membership,
  'memberId' | 'sub' | 'username' | 'role' | 'activationState'
>;
type AuthorizingHouseholdRecord = Pick<Household, 'householdId' | 'name' | 'timezone'>;

/**
 * Resolves only the persisted fields that establish caller identity and household authority.
 * Creation-time metadata and optimistic-concurrency versions are validated by their owning writes,
 * not repeatedly on an unrelated authorization read.
 */
export function resolveMembershipRecords(
  lookup: MembershipLookup,
  membership: AuthorizingMembershipRecord,
  household: AuthorizingHouseholdRecord,
  sub: string,
  tokenIssuedAt?: number,
): MembershipResolution {
  if (!membershipAuthorityMatches(lookup, membership, household, sub)) {
    return { kind: MembershipResolutionKind.inconsistent };
  }
  if (lookup.credentialsValidAfter && !isStoredTimestamp(lookup.credentialsValidAfter)) {
    return { kind: MembershipResolutionKind.inconsistent };
  }
  if (lookup.activationState === MembershipActivationState.pendingActivation) {
    if (lookup.role !== HouseholdRole.parent) {
      return { kind: MembershipResolutionKind.inconsistent };
    }
    return { kind: MembershipResolutionKind.pendingActivation };
  }
  if (lookup.activationState === MembershipActivationState.inactive) {
    return { kind: MembershipResolutionKind.inactive };
  }
  if (
    lookup.credentialsValidAfter &&
    !isTokenIssuedAfter(lookup.credentialsValidAfter, tokenIssuedAt)
  ) {
    return { kind: MembershipResolutionKind.credentialsStale };
  }
  return {
    kind: MembershipResolutionKind.active,
    membership: {
      memberId: lookup.memberId,
      username: lookup.username,
      role: lookup.role,
      household: {
        householdId: lookup.householdId,
        name: household.name,
        timezone: household.timezone,
      },
    },
  };
}

function membershipAuthorityMatches(
  lookup: MembershipLookup,
  membership: AuthorizingMembershipRecord,
  household: AuthorizingHouseholdRecord,
  sub: string,
): boolean {
  return (
    household.householdId === lookup.householdId &&
    membership.memberId === lookup.memberId &&
    membership.sub === sub &&
    membership.username === lookup.username &&
    membership.role === lookup.role &&
    membership.activationState === lookup.activationState
  );
}

function membershipFromReplayItem(item: Record<string, AttributeValue>): CurrentMembership {
  return currentMembership({
    memberId: requiredStringAttribute(item.memberId),
    householdId: requiredStringAttribute(item.householdId),
    name: requiredStringAttribute(item.name),
    timezone: requiredStringAttribute(item.timezone),
    username: requiredStringAttribute(item.username),
  });
}

function profileFromItem(item: Record<string, AttributeValue>): Profile {
  return {
    memberId: requiredStringAttribute(item.memberId),
    displayName: requiredStringAttribute(item.displayName),
    color: requiredProfileColor(item.color),
    version: requiredNumberAttribute(item.version),
  };
}

function directoryMemberFromStoredItem(
  membership: Record<string, AttributeValue>,
  profile: Profile | null,
): FamilyDirectoryMember {
  if (!profile && requiredMembershipRole(membership.role) !== HouseholdRole.parent)
    throw missingProfileError();
  return {
    memberId: requiredStringAttribute(membership.memberId),
    username: requiredStringAttribute(membership.username),
    role: requiredMembershipRole(membership.role),
    activationState: requiredActivationState(membership.activationState),
    ...(profile ? { displayName: profile.displayName, color: profile.color } : {}),
  };
}

function isVisibleDirectoryMembership(item: Record<string, AttributeValue>): boolean {
  const activationState = requiredActivationState(item.activationState);
  if (activationState === MembershipActivationState.active) return true;
  return (
    activationState === MembershipActivationState.pendingActivation &&
    requiredMembershipRole(item.role) === HouseholdRole.parent
  );
}

function isVisibleInMemoryDirectoryMembership(membership: Membership): boolean {
  if (membership.activationState === MembershipActivationState.active) return true;
  return (
    membership.activationState === MembershipActivationState.pendingActivation &&
    membership.role === HouseholdRole.parent
  );
}

function sortDirectoryMembers(members: FamilyDirectoryMember[]): FamilyDirectoryMember[] {
  const activationOrder: Record<MembershipActivationStateValue, number> = {
    [MembershipActivationState.active]: 0,
    [MembershipActivationState.pendingActivation]: 1,
    [MembershipActivationState.inactive]: 2,
  };
  return members.sort(
    (left, right) =>
      activationOrder[left.activationState] - activationOrder[right.activationState] ||
      left.username.localeCompare(right.username) ||
      left.memberId.localeCompare(right.memberId),
  );
}

function putItem(
  tableName: string,
  item: Record<string, AttributeValue>,
  conditionExpression?: string,
) {
  return {
    Put: {
      TableName: tableName,
      Item: item,
      ...(conditionExpression ? { ConditionExpression: conditionExpression } : {}),
    },
  };
}
function stringAttribute(value: string): AttributeValue {
  return { S: value };
}
function numberAttribute(value: number): AttributeValue {
  // DynamoDB's AttributeValue wire format represents every number as a decimal string.
  return { N: String(value) };
}
const INVALID_STORED_HOUSEHOLD_RECORD = 'Stored household record is invalid.';
function requiredNumberAttribute(value: AttributeValue | undefined): number {
  if (!value || !('N' in value) || !value.N) throw new Error(INVALID_STORED_HOUSEHOLD_RECORD);
  const number = Number(value.N);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(INVALID_STORED_HOUSEHOLD_RECORD);
  return number;
}
function requiredStringAttribute(value: AttributeValue | undefined): string {
  if (!value || !('S' in value) || !value.S) throw new Error(INVALID_STORED_HOUSEHOLD_RECORD);
  return value.S;
}
function requiredMembershipRole(value: AttributeValue | undefined): MembershipRole {
  const role = requiredStringAttribute(value);
  if (role !== HouseholdRole.parent && role !== HouseholdRole.child)
    throw new Error('Stored role is invalid.');
  return role;
}
function requiredActivationState(
  value: AttributeValue | undefined,
): MembershipActivationStateValue {
  const state = requiredStringAttribute(value);
  const allowedActivationStates = Object.values(MembershipActivationState);
  if (!allowedActivationStates.includes(state as MembershipActivationStateValue)) {
    throw new Error('Stored membership activation state is invalid.');
  }
  return state as MembershipActivationStateValue;
}
function requiredProfileColor(value: AttributeValue | undefined): Profile['color'] {
  const color = requiredStringAttribute(value);
  if (!Object.values(ProfileColor).includes(color as Profile['color'])) {
    throw new Error('Stored profile color is invalid.');
  }
  return color as Profile['color'];
}
function profileStorageKey(householdId: string, memberId: string): string {
  return `${householdId}\0${memberId}`;
}
function isExpectedProfileVersion(existing: Profile | null, requestedVersion: number): boolean {
  // Exact comparison prevents both stale retries and skipped/out-of-order writes.
  return existing ? existing.version === requestedVersion : requestedVersion === 0;
}
export function isTokenCurrent(value: AttributeValue | undefined, issuedAt?: number): boolean {
  if (!value) return true;
  if (issuedAt === undefined) return false;
  const cutoff = Date.parse(requiredStringAttribute(value));
  if (Number.isNaN(cutoff)) throw new Error('Stored credential cutoff is invalid.');
  return issuedAt * 1000 > cutoff;
}
function isTokenIssuedAfter(cutoff: string, issuedAt?: number): boolean {
  if (issuedAt === undefined || !Number.isSafeInteger(issuedAt) || issuedAt < 0) return false;
  const cutoffMilliseconds = Date.parse(cutoff);
  return !Number.isNaN(cutoffMilliseconds) && issuedAt * 1000 > cutoffMilliseconds;
}
function isStoredTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}
function membershipStorageKey(householdId: string, memberId: string): string {
  return `${householdId}\0${memberId}`;
}
function cloneProfile(profile: Profile | null): Profile | null {
  return profile ? structuredClone(profile) : null;
}
function missingProfileError(): Error {
  return new Error('Stored active household member is missing a profile.');
}
function hashInput(name: string, timezone: string, username: string): string {
  return createHash('sha256').update(JSON.stringify({ name, timezone, username })).digest('hex');
}
