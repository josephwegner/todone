import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLocalResetSafe } from '../../../local-dev/resetDatabase';
import { requireLocalCognitoEndpoint } from '../../../local-dev/configuration';
import {
  loadLocalSeed,
  seedLocalHousehold,
  validateSeedManifest,
} from '../../../local-dev/seedHousehold';
import { InMemoryHouseholdRepository } from '../../../lambdas/households/repository';
import { activateParentHandler } from '../../../lambdas/households/parentHandlers';
import { handler as removeChild } from '../../../lambdas/households/removeChild';
import { handler as resetPassword } from '../../../lambdas/households/resetChildPassword';
import { updateHandler as updateProfile } from '../../../lambdas/households/profile';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { CognitoAdministration } from '../../../lambdas/cognito/administration';
const seed = {
  version: 1,
  userPoolId: 'local_seed',
  accounts: {
    localdev: '10000000-0000-4000-8000-000000000001',
    localparent2: '10000000-0000-4000-8000-000000000002',
    localchild: '10000000-0000-4000-8000-000000000003',
  },
};
const directories: string[] = [];
function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'todone-seed-test-'));
  directories.push(root);
  mkdirSync(join(root, '.cognito/db'), { recursive: true });
  writeFileSync(
    join(root, '.cognito/config.json'),
    JSON.stringify({
      TokenConfig: { IssuerDomain: 'http://localhost:9229' },
      UserPoolDefaults: { UsernameAttributes: [] },
    }),
  );
  writeFileSync(join(root, '.cognito/db/keep.json'), 'sentinel');
  return root;
}
afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe('local destructive reset boundary', () => {
  it.each([
    { NODE_ENV: 'production' },
    { COGNITO_LOCAL_ENDPOINT: 'https://cognito-idp.us-east-1.amazonaws.com' },
    { COGNITO_LOCAL_ENDPOINT: 'http://localhost:9229.evil.test' },
    { COGNITO_LOCAL_ENDPOINT: 'http://user:secret@localhost:9229' },
    { COGNITO_LOCAL_ENDPOINT: 'http://localhost:9230' },
  ])('refuses unsafe configuration before data deletion or service probes', async (environment) => {
    const root = workspace(),
      probe = vi.fn();
    await expect(assertLocalResetSafe(root, environment, probe)).rejects.toThrow();
    expect(probe).not.toHaveBeenCalled();
    expect(readFileSync(join(root, '.cognito/db/keep.json'), 'utf8')).toBe('sentinel');
  });
  it('checks both loopback address families and refuses an occupied SSH/service port without wiping', async () => {
    const root = workspace(),
      probe = vi.fn(async (port: number, host: string) => port === 3001 && host === '::1');
    await expect(assertLocalResetSafe(root, {}, probe)).rejects.toThrow('Port 3001 is in use');
    expect(probe).toHaveBeenCalledTimes(6);
    expect(readFileSync(join(root, '.cognito/db/keep.json'), 'utf8')).toBe('sentinel');
  });
  it.each(['.cognito/db', '.env.local', '.local-dev'])(
    'refuses a symlinked %s before probing services',
    async (target) => {
      const root = workspace(),
        other = workspace(),
        probe = vi.fn();
      if (target === '.cognito/db') rmSync(join(root, target), { recursive: true });
      symlinkSync(join(other, '.cognito/db'), join(root, target));
      await expect(assertLocalResetSafe(root, {}, probe)).rejects.toThrow('symlink');
      expect(probe).not.toHaveBeenCalled();
      expect(readFileSync(join(other, '.cognito/db/keep.json'), 'utf8')).toBe('sentinel');
    },
  );
  it('refuses emulator configuration capable of changing the reset network boundary', async () => {
    const root = workspace();
    writeFileSync(
      join(root, '.cognito/config.json'),
      JSON.stringify({ ServerConfig: { hostname: '0.0.0.0', port: 9229 } }),
    );
    await expect(assertLocalResetSafe(root, {}, vi.fn())).rejects.toThrow('configuration');
  });
  it.each(['reset.lock', 'seed.json.tmp'])(
    'refuses a stale %s without touching the database',
    async (name) => {
      const root = workspace();
      mkdirSync(join(root, '.local-dev'));
      writeFileSync(join(root, '.local-dev', name), 'unfinished');
      await expect(assertLocalResetSafe(root, {}, vi.fn())).rejects.toThrow('unfinished');
      expect(readFileSync(join(root, '.cognito/db/keep.json'), 'utf8')).toBe('sentinel');
    },
  );
  it('permits only the supported loopback endpoints', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]'])
      expect(requireLocalCognitoEndpoint({ COGNITO_LOCAL_ENDPOINT: `http://${host}:9229` })).toBe(
        `http://${host}:9229`,
      );
  });
});
describe('explicit local seed initialization', () => {
  it('rejects stale, incomplete and overlapping identities', () => {
    for (const input of [
      null,
      { ...seed, version: 2 },
      { ...seed, userPoolId: 'local_stale' },
      { ...seed, accounts: {} },
      { ...seed, accounts: { ...seed.accounts, localparent2: seed.accounts.localdev } },
    ])
      expect(() => validateSeedManifest(input, seed.userPoolId)).toThrow();
    expect(validateSeedManifest(seed, seed.userPoolId)).toEqual(seed);
  });
  it('requires explicit development mode and refuses production/remote startup before creating memberships', async () => {
    const root = workspace();
    mkdirSync(join(root, '.local-dev'));
    writeFileSync(join(root, '.local-dev/seed.json'), JSON.stringify(seed));
    const repository = new InMemoryHouseholdRepository();
    for (const env of [
      {},
      { TODONE_LOCAL_DEVELOPMENT: 'true', NODE_ENV: 'production' },
      { TODONE_LOCAL_DEVELOPMENT: 'true', COGNITO_LOCAL_ENDPOINT: 'https://remote.test' },
    ])
      await expect(loadLocalSeed(repository, root, env)).rejects.toThrow();
    expect((await repository.resolveMembership(seed.accounts.localdev)).kind).toBe('unattached');
  });
  it('does not turn ordinary pending accounts into verified fixtures', async () => {
    const repository = new InMemoryHouseholdRepository();
    await seedLocalHousehold(repository, seed);
    const first = await repository.resolveMembership(seed.accounts.localdev);
    if (first.kind !== 'active') throw new Error('seed invariant');
    const pendingSub = '10000000-0000-4000-8000-000000000004';
    await repository.pendingParents.provision(
      {
        callerSub: seed.accounts.localdev,
        householdId: first.membership.household.householdId,
        username: 'ordinary-pending',
        email: 'pending@example.test',
        idempotencyKey: 'ordinary-pending',
      },
      pendingSub,
    );
    const event = {
      headers: {},
      requestContext: {
        requestId: 'pending-seed-denial',
        http: { method: 'POST' },
        authorizer: {
          jwt: {
            claims: {
              token_use: 'id',
              sub: pendingSub,
              'cognito:username': 'ordinary-pending',
              email: 'pending@example.test',
              email_verified: true,
            },
          },
        },
      },
    } as unknown as APIGatewayProxyEventV2;
    expect(
      (await activateParentHandler(event, { repository, activationAvailable: false })).statusCode,
    ).toBe(503);
    expect((await repository.resolveMembership(pendingSub)).kind).toBe('pending-activation');
  });
  it('reconstructs the same authorized household and profiles in each fresh repository', async () => {
    for (let run = 0; run < 2; run++) {
      const repository = new InMemoryHouseholdRepository();
      await seedLocalHousehold(repository, seed);
      const first = await repository.resolveMembership(seed.accounts.localdev);
      const second = await repository.resolveMembership(seed.accounts.localparent2);
      const child = await repository.resolveMembership(seed.accounts.localchild);
      expect(first.kind).toBe('active');
      expect(second.kind).toBe('active');
      expect(child.kind).toBe('active');
      if (first.kind !== 'active' || second.kind !== 'active' || child.kind !== 'active')
        throw new Error('seed invariant');
      expect(first.membership.household).toEqual(second.membership.household);
      expect(first.membership.household).toEqual(child.membership.household);
      expect(second.membership.role).toBe('parent');
      expect(
        await repository.getProfile(
          second.membership.household.householdId,
          second.membership.memberId,
        ),
      ).toBeNull();
      expect(child.membership.role).toBe('child');
      expect(
        await repository.listFamilyMembers(first.membership.household.householdId),
      ).toHaveLength(3);
      const administration = {
        deleteUser: vi.fn(),
        setPermanentPassword: vi.fn(),
      } as unknown as CognitoAdministration;
      const event = (body: unknown) =>
        ({
          body: JSON.stringify(body),
          headers: { 'idempotency-key': 'test' },
          pathParameters: { memberId: first.membership.memberId },
          requestContext: {
            requestId: 'seed-test',
            http: { method: 'DELETE' },
            authorizer: {
              jwt: {
                claims: {
                  token_use: 'id',
                  sub: seed.accounts.localparent2,
                  'cognito:username': 'localparent2',
                },
              },
            },
          },
        }) as unknown as APIGatewayProxyEventV2;
      expect(
        (await removeChild(event({ confirmation: true }), { repository, administration }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await resetPassword(event({ password: 'DisposableChanged123!' }), {
            repository,
            administration,
          })
        ).statusCode,
      ).toBe(403);
      expect(administration.deleteUser).not.toHaveBeenCalled();
      expect(administration.setPermanentPassword).not.toHaveBeenCalled();
      expect(
        (
          await updateProfile(
            event({
              displayName: 'Peer overwrite',
              color: 'LAKE',
              version: 1,
              memberId: first.membership.memberId,
            }),
            { repository },
          )
        ).statusCode,
      ).toBe(422);
      expect(
        await repository.getProfile(
          first.membership.household.householdId,
          first.membership.memberId,
        ),
      ).toMatchObject({ displayName: 'Local Parent' });
    }
  });
});
