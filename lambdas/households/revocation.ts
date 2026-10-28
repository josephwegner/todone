import { createHash } from 'node:crypto';
import type { ConditionalRecordStore } from './pendingParents';
import type { HouseholdStorageKey } from './keys';
/** Kept equal to the explicitly configured one-hour Cognito ID-token validity in Terraform. */
export const ID_TOKEN_VALIDITY_SECONDS = 3600;
export const TOKEN_CLOCK_TOLERANCE_SECONDS = 60;
export function revocationKey(sub: string): HouseholdStorageKey {
  return { pk: `REVOKED#${createHash('sha256').update(sub).digest('hex')}`, sk: 'REVOCATION' };
}
export function revocationExpiry(now = Date.now()): number {
  return Math.ceil(now / 1000) + ID_TOKEN_VALIDITY_SECONDS + TOKEN_CLOCK_TOLERANCE_SECONDS;
}
/** Expired markers are not authority; TTL is physical cleanup, never an authorization clock. */
export async function isRevoked(
  store: ConditionalRecordStore,
  sub: string,
  now = Date.now(),
): Promise<boolean> {
  const key = revocationKey(sub),
    row = await store.read(key);
  if (!row) return false;
  if (typeof row.expiresAt === 'number' && row.expiresAt * 1000 <= now) {
    const removed = await store.transact([
      { key, expected: { expiresAt: row.expiresAt }, delete: true },
    ]);
    return !removed;
  }
  return true;
}
