import { describe, expect, it } from 'vitest';
import {
  createAuthStorage,
  createMemoryAuthStorage,
  type AuthStorageDependencies,
} from '../../session/authStorage';
import {
  authMarkerKey,
  localCredentialKey,
  sdkAuthPrefix,
} from '../../session/authStorageContract';
import { AuthStorageUnavailableError } from '../../services/authSessionErrors';

function fixture() {
  const shared = createMemoryAuthStorage();
  let sequence = 0;
  let queue = Promise.resolve();
  const exclusive: AuthStorageDependencies['exclusive'] = (work) => {
    const pending = queue.then(work);
    queue = pending.then(
      () => {},
      () => {},
    );
    return pending;
  };
  const tab = (legacy = createMemoryAuthStorage()) =>
    createAuthStorage('client', {
      shared: () => shared,
      legacy: () => legacy,
      exclusive,
      nonce: () => `generation-${++sequence}`,
    });
  return { shared, tab, exclusive };
}
async function signIn(storage: ReturnType<typeof createAuthStorage>, value = 'sdk-credentials') {
  const stage = await storage.beginSignIn();
  stage.storage.setItem(localCredentialKey('client'), value);
  const marker = await storage.publish(stage);
  expect(marker?.kind).toBe('signed-in');
  return marker!;
}
describe('versioned browser auth storage', () => {
  it('restores the same account across new adapter instances, tabs, and returning browser storage', async () => {
    const { tab } = fixture();
    const marker = await signIn(tab());
    for (let index = 0; index < 3; index++) {
      const restored = await tab().restoreBinding();
      expect(restored.marker).toEqual(marker);
      expect(restored.binding?.storage.getItem(localCredentialKey('client'))).toBe(
        'sdk-credentials',
      );
    }
  });
  it('never promotes conflicting legacy tab accounts, and preserves a valid new-format shared account', async () => {
    const { tab, shared } = fixture();
    const firstLegacy = createMemoryAuthStorage();
    const secondLegacy = createMemoryAuthStorage();
    firstLegacy.setItem(`${sdkAuthPrefix('client')}one.idToken`, 'old-account-one');
    secondLegacy.setItem(localCredentialKey('client'), 'old-account-two');
    firstLegacy.setItem('unrelated', 'keep');
    const first = tab(firstLegacy);
    const second = tab(secondLegacy);
    expect(await first.initialize()).toMatchObject({
      marker: { kind: 'signed-out' },
      migratedLegacy: true,
    });
    expect(firstLegacy.getItem('unrelated')).toBe('keep');
    await signIn(first, 'explicit-new-account');
    const restored = await second.restoreBinding();
    expect(secondLegacy.length).toBe(0);
    expect(restored.migratedLegacy).toBe(false);
    expect(restored.binding?.storage.getItem(localCredentialKey('client'))).toBe(
      'explicit-new-account',
    );
    expect(
      [...Array(shared.length)].map((_, index) => shared.getItem(shared.key(index)!)).join(''),
    ).not.toContain('old-account');
  });
  it('persists only allowed SDK authentication keys and excludes SDK user-data/private records', async () => {
    const { tab, shared } = fixture();
    const storage = tab();
    const stage = await storage.beginSignIn();
    for (const key of ['profile', 'household', `${sdkAuthPrefix('client')}parent.userData`])
      stage.storage.setItem(key, 'private-canary');
    stage.storage.setItem(`${sdkAuthPrefix('client')}LastAuthUser`, 'parent');
    stage.storage.setItem(`${sdkAuthPrefix('client')}parent.refreshToken`, 'sdk-refresh');
    await storage.publish(stage);
    const values = [...Array(shared.length)].map((_, index) => shared.getItem(shared.key(index)!));
    expect(values.join('')).not.toContain('private-canary');
    expect(values).toContain('sdk-refresh');
  });
  it('publishes a durable tombstone before cleanup and never resurrects late provider writes', async () => {
    const { tab, shared } = fixture();
    const storage = tab();
    await signIn(storage);
    const old = (await storage.restoreBinding()).binding!;
    shared.setItem('unrelated', 'keep');
    const marker = await storage.signOut();
    old.storage.setItem(localCredentialKey('client'), 'late-credential');
    expect((await tab().restoreBinding()).binding).toBeNull();
    expect(storage.readMarker()).toEqual(marker);
    expect(shared.length).toBe(2);
    expect(shared.getItem('unrelated')).toBe('keep');
  });
  it('rejects in-flight sign-in publication after peer sign-out', async () => {
    const { tab } = fixture();
    const first = tab();
    const second = tab();
    const stage = await first.beginSignIn();
    stage.storage.setItem(localCredentialKey('client'), 'old-attempt');
    await second.signOut();
    expect(await first.publish(stage)).toBeNull();
    stage.storage.setItem(localCredentialKey('client'), 'late');
    expect((await first.restoreBinding()).binding).toBeNull();
  });
  it('does not let obsolete SDK cleanup or terminal invalidation delete a peer’s new account', async () => {
    const { tab } = fixture();
    const first = tab();
    const oldMarker = await signIn(first, 'first-account');
    const old = (await first.restoreBinding()).binding!;
    const second = tab();
    const next = await signIn(second, 'second-account');
    old.storage.clear();
    old.storage.setItem(localCredentialKey('client'), 'late-old-account');
    await first.signOut(oldMarker.generation);
    const restored = await first.restoreBinding();
    expect(restored.marker).toEqual(next);
    expect(restored.binding?.storage.getItem(localCredentialKey('client'))).toBe('second-account');
  });
  it('serializes simultaneous explicit publications and permits only one captured-generation winner', async () => {
    const { tab } = fixture();
    const first = tab();
    const second = tab();
    const [one, two] = await Promise.all([first.beginSignIn(), second.beginSignIn()]);
    one.storage.setItem(localCredentialKey('client'), 'one');
    two.storage.setItem(localCredentialKey('client'), 'two');
    const results = await Promise.all([first.publish(one), second.publish(two)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
  it('reports corrupt metadata safely, then permits explicit scoped sign-out recovery', async () => {
    const { tab, shared } = fixture();
    shared.setItem(authMarkerKey('client'), '{private malformed value');
    shared.setItem('unrelated', 'keep');
    const storage = tab();
    await expect(storage.initialize()).rejects.toBeInstanceOf(AuthStorageUnavailableError);
    await storage.signOut();
    expect(storage.readMarker()?.kind).toBe('signed-out');
    expect(shared.getItem('unrelated')).toBe('keep');
  });
  it('returns an explicit safe failure when browser storage cannot be accessed', async () => {
    const { exclusive } = fixture();
    const storage = createAuthStorage('client', {
      exclusive,
      nonce: () => 'safe-generation',
      legacy: createMemoryAuthStorage,
      shared: () => {
        throw new Error('private browser diagnostic');
      },
    });
    await expect(storage.initialize()).rejects.toThrow('AUTH_STORAGE_UNAVAILABLE');
  });
});
