import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { createAppRouter } from '../../router';
import { AppRouteName } from '../../router/routes';
import {
  createSessionController,
  type SessionContextResult,
} from '../../session/sessionController';
const membership = {
  memberId: 'child-member',
  username: 'child-one',
  role: 'child' as const,
  household: { householdId: 'house-one', name: 'River House', timezone: 'America/Chicago' },
};
const profile = {
  memberId: 'child-member',
  displayName: 'Moss',
  color: 'MOSS' as const,
  version: 1,
};
const credentials = { idToken: 'token', accessToken: 'access', expiresAt: new Date('2030-01-01') };
function fixture(signedIn = true) {
  const restore = vi.fn(async () =>
    signedIn ? { kind: 'usable' as const, credentials } : { kind: 'signed-out' as const },
  );
  const readContext = vi.fn(async (): Promise<SessionContextResult> => ({
    kind: 'success',
    context: { kind: 'active', membership, profile },
  }));
  const session = createSessionController({
    provider: { restore, signIn: vi.fn(), signOut: vi.fn() },
    readContext,
  });
  const router = createAppRouter(session, createMemoryHistory());
  return { restore, readContext, session, router };
}
describe('controller-owned route access', () => {
  beforeEach(() => vi.clearAllMocks());
  it('replaces signed-out protected deep links with sign in', async () => {
    const { router } = fixture(false);
    await router.push('/family');
    expect(router.currentRoute.value.fullPath).toBe('/sign-in');
  });
  it('routes active children to Todos and keeps parent-only pages unavailable', async () => {
    const { router } = fixture();
    for (const destination of ['/', '/family/children/new', '/family/children/peer/password']) {
      await router.push(destination);
      expect(router.currentRoute.value.fullPath).toBe('/todos');
    }
  });
  it('reuses ready context across links, Back/Forward, and deep-link initialization', async () => {
    const { router, restore, readContext } = fixture();
    await router.push('/profile');
    await router.push('/todos');
    await router.push('/profile');
    const back = new Promise<void>((resolve) => {
      const remove = router.afterEach(() => {
        remove();
        resolve();
      });
    });
    router.back();
    await back;
    expect(router.currentRoute.value.fullPath).toBe('/todos');
    const forward = new Promise<void>((resolve) => {
      const remove = router.afterEach(() => {
        remove();
        resolve();
      });
    });
    router.forward();
    await forward;
    expect(router.currentRoute.value.fullPath).toBe('/profile');
    expect(restore).toHaveBeenCalledOnce();
    expect(readContext).toHaveBeenCalledOnce();
  });
  it('discards an old membership result after sign-out during a guarded startup', async () => {
    const { router, session, readContext } = fixture();
    let finish!: (value: SessionContextResult) => void;
    readContext.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const navigation = router.push('/profile');
    await vi.waitFor(() => expect(readContext).toHaveBeenCalledOnce());
    session.signOut();
    finish({ kind: 'success', context: { kind: 'active', membership, profile } });
    await navigation;
    expect(router.currentRoute.value.fullPath).toBe('/sign-in');
    expect(session.state.value.kind).toBe('signed-out');
  });
  it('preserves the canonical public route without secret history state', async () => {
    const { router } = fixture(false);
    await router.push({ name: AppRouteName.verifyEmail });
    expect(router.currentRoute.value.fullPath).toBe('/verify-email');
    expect(router.currentRoute.value.query).toEqual({});
    expect(router.currentRoute.value.hash).toBe('');
  });
});
