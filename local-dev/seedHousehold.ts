import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalDevelopment, requireLocalCognitoEndpoint } from './configuration';
import { localFixtureAccounts, LOCAL_FIXTURE_HOUSEHOLD } from './fixtures';
import type { InMemoryHouseholdRepository } from '../lambdas/households/repository';

export interface LocalSeedManifest {
  version: number;
  userPoolId: string;
  accounts: Record<string, string>;
}

export function validateSeedManifest(
  value: unknown,
  userPoolId: string | undefined,
): LocalSeedManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid local seed manifest.');
  const seed = value as LocalSeedManifest;
  if (
    seed.version !== LocalDevelopment.seedVersion ||
    !userPoolId?.startsWith('local_') ||
    seed.userPoolId !== userPoolId ||
    !seed.accounts ||
    typeof seed.accounts !== 'object' ||
    Array.isArray(seed.accounts) ||
    Object.keys(seed.accounts).length !== localFixtureAccounts.length ||
    localFixtureAccounts.some(
      (account) =>
        typeof seed.accounts[account.username] !== 'string' ||
        !/^[\da-f-]{36}$/i.test(seed.accounts[account.username]!),
    ) ||
    new Set(Object.values(seed.accounts)).size !== localFixtureAccounts.length
  )
    throw new Error(
      'Local seed identities do not match this emulator; run npm run db:reset:local with services stopped.',
    );
  return seed;
}

/** Creates explicit fixture state before serving requests; it is not an email-verification operation. */
export async function seedLocalHousehold(
  repository: InMemoryHouseholdRepository,
  seed: LocalSeedManifest,
): Promise<void> {
  const [first, second, child] = localFixtureAccounts;
  const ownerSub = seed.accounts[first.username]!;
  const bootstrap = await repository.bootstrap({
    sub: ownerSub,
    username: first.username,
    idempotencyKey: 'local-fixture-household',
    ...LOCAL_FIXTURE_HOUSEHOLD,
  });
  if (bootstrap.kind !== 'created' && bootstrap.kind !== 'replayed')
    throw new Error('Local fixture household could not be initialized.');
  const householdId = bootstrap.membership.household.householdId;
  await repository.saveProfile({
    householdId,
    memberId: bootstrap.membership.memberId,
    displayName: first.displayName,
    color: first.color,
    version: 0,
  });
  await repository.pendingParents.provision(
    {
      callerSub: ownerSub,
      householdId,
      username: second.username,
      email: second.email,
      idempotencyKey: 'local-fixture-parent',
    },
    seed.accounts[second.username]!,
  );
  const context = await repository.pendingParents.context(seed.accounts[second.username]!);
  const owner = 'local-fixture-initialization';
  await repository.pendingParents.acquire(context, owner);
  await repository.pendingParents.activate(context, owner);
  const provision = await repository.provisionChild({
    callerSub: ownerSub,
    householdId,
    childSub: seed.accounts[child.username]!,
    username: child.username,
    displayName: child.displayName,
    color: child.color,
    idempotencyKey: 'local-fixture-child',
  });
  if (provision.kind !== 'created')
    throw new Error('Local child fixture could not be initialized.');
}

export async function loadLocalSeed(
  repository: InMemoryHouseholdRepository,
  rootDirectory = fileURLToPath(new URL('../', import.meta.url)),
  environment: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const path = join(rootDirectory, LocalDevelopment.seedDirectory, LocalDevelopment.seedFile);
  if (!existsSync(path)) return false;
  if (environment.TODONE_LOCAL_DEVELOPMENT !== 'true')
    throw new Error('Seeded accounts require explicit local development.');
  requireLocalCognitoEndpoint(environment);
  const manifest = validateSeedManifest(
    JSON.parse(readFileSync(path, 'utf8')),
    environment.COGNITO_USER_POOL_ID,
  );
  await seedLocalHousehold(repository, manifest);
  return true;
}
