import { HouseholdRole, MembershipActivationState } from './constants';
import type { HouseholdMemberTarget } from './model';
import {
  householdMemberKey,
  membershipLookupKey,
  profileKey,
  childProvisionReplayKey,
  type HouseholdStorageKey,
} from './keys';
import {
  digestInput,
  type ConditionalRecordStore,
  PendingParentFailure,
  type ConditionalRecordWrite,
} from './pendingParents';
import { revocationKey, revocationExpiry } from './revocation';
export const CHILD_REMOVAL_ROUTE = '/api/v1/family-members/{memberId}';
export interface ChildRemovalContext {
  householdId: string;
  target: HouseholdMemberTarget;
  owner: string;
  parentSubs: string[];
}
export interface ChildRemovalStep {
  kind: string;
  remove(store: ConditionalRecordStore, context: ChildRemovalContext): Promise<void>;
}
const REPLAY_PREFIX = childProvisionReplayKey('', '').sk;
/** Every deployed child-associated entity must extend this registry and failure-boundary tests. */
export const childRemovalSteps: readonly ChildRemovalStep[] = [
  {
    kind: 'profile',
    async remove(store, c) {
      if (
        !(await store.transact([
          {
            key: profileKey(c.householdId, c.target.memberId),
            expected: { memberId: c.target.memberId },
            delete: true,
          },
        ]))
      )
        throw new PendingParentFailure('unavailable');
    },
  },
  {
    kind: 'provisioning-replay',
    async remove(store, c) {
      if (!store.query) throw new PendingParentFailure('unavailable');
      for (const sub of c.parentSubs) {
        const rows = await store.query(membershipLookupKey(sub).pk, REPLAY_PREFIX);
        for (const row of rows) {
          if (
            row.memberId === c.target.memberId &&
            typeof row.pk === 'string' &&
            typeof row.sk === 'string'
          )
            if (
              !(await store.transact([
                {
                  key: { pk: row.pk, sk: row.sk },
                  expected: { memberId: c.target.memberId },
                  delete: true,
                },
              ]))
            )
              throw new PendingParentFailure('conflict');
        }
      }
    },
  },
];
export class ChildRemovalRepository {
  constructor(private readonly store: ConditionalRecordStore) {}
  private replayKey(callerSub: string, key: string): HouseholdStorageKey {
    return {
      pk: membershipLookupKey(callerSub).pk,
      sk: `IDEMPOTENCY#REMOVE_CHILD#${digestInput(CHILD_REMOVAL_ROUTE, key)}`,
    };
  }
  async replay(callerSub: string, key: string, memberId: string): Promise<boolean> {
    const row = await this.store.read(this.replayKey(callerSub, key));
    if (!row) return false;
    if (row.target !== digestInput(memberId)) throw new PendingParentFailure('conflict');
    return true;
  }
  async begin(c: ChildRemovalContext): Promise<void> {
    const t = c.target;
    if (t.role !== HouseholdRole.child || t.activationState !== MembershipActivationState.active)
      throw new PendingParentFailure('unavailable');
    const shared = {
      memberId: t.memberId,
      username: t.username,
      role: HouseholdRole.child,
      activationState: MembershipActivationState.active,
    };
    if (
      !(await this.store.transact([
        {
          key: membershipLookupKey(t.sub),
          expected: { ...shared, householdId: c.householdId, removalOwner: undefined },
          set: { activationState: MembershipActivationState.inactive, removalOwner: c.owner },
        },
        {
          key: householdMemberKey(c.householdId, t.memberId),
          expected: { ...shared, sub: t.sub },
          set: { activationState: MembershipActivationState.inactive },
        },
        { key: revocationKey(t.sub), expected: { pk: undefined }, put: { removalOwner: c.owner } },
      ]))
    )
      throw new PendingParentFailure('conflict');
  }
  async purge(c: ChildRemovalContext, steps = childRemovalSteps): Promise<void> {
    for (const step of steps) await step.remove(this.store, c);
    const t = c.target;
    const writes: ConditionalRecordWrite[] = [
      {
        key: membershipLookupKey(t.sub),
        expected: {
          memberId: t.memberId,
          householdId: c.householdId,
          activationState: MembershipActivationState.inactive,
          removalOwner: c.owner,
        },
        delete: true,
      },
      {
        key: householdMemberKey(c.householdId, t.memberId),
        expected: {
          memberId: t.memberId,
          sub: t.sub,
          role: HouseholdRole.child,
          activationState: MembershipActivationState.inactive,
        },
        delete: true,
      },
    ];
    if (!(await this.store.transact(writes))) throw new PendingParentFailure('conflict');
  }
  async complete(c: ChildRemovalContext, callerSub: string, key: string): Promise<void> {
    if (
      !(await this.store.transact([
        {
          key: revocationKey(c.target.sub),
          expected: { removalOwner: c.owner, expiresAt: undefined },
          set: { expiresAt: revocationExpiry() },
          remove: ['removalOwner'],
        },
        {
          key: this.replayKey(callerSub, key),
          expected: { pk: undefined },
          put: { target: digestInput(c.target.memberId) },
        },
      ]))
    )
      throw new PendingParentFailure('conflict');
  }
}
