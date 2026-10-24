import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import ParentAccountPage from '../../components/ParentAccountPage.vue';
import { appRouteDefinitions } from '../../router/routes';
import { createSessionController, type SessionDependencies } from '../../session/sessionController';
import { sessionControllerKey } from '../../session/injection';
import { activateParent } from '../../services/parentAccountClient';
import { ParentAccountError } from '../../../shared/familyAccountContract';
vi.mock('../../services/parentAccountClient', () => ({
  activateParent: vi.fn(),
  createParent: vi.fn(),
}));
const error = (code: string, conflict = false) => ({
  kind: 'error' as const,
  code,
  conflict,
  recoverable: true,
  message: 'Try again',
});
async function fixture() {
  const credentials = {
    idToken: 'synthetic-id',
    accessToken: 'synthetic-access',
    expiresAt: new Date(Date.now() + 3600000),
  };
  const provider = {
    restore: vi.fn(async () => ({ kind: 'usable' as const, credentials })),
    renew: vi.fn(async () => ({ kind: 'usable' as const, credentials })),
    signIn: vi.fn(),
    signOut: vi.fn(),
  };
  const verify = vi.fn().mockResolvedValue({ kind: 'success' });
  const controller = createSessionController({
    provider,
    account: { verifyEmailAttribute: verify } as unknown as SessionDependencies['account'],
    readContext: async () => ({ kind: 'error', failure: 'pending-activation' }),
  });
  await controller.initialize();
  const refresh = vi.spyOn(controller, 'refreshContext');
  const router = createRouter({
    history: createMemoryHistory(),
    routes: Object.values(appRouteDefinitions).map(({ name, path }) => ({
      name,
      path,
      component: ParentAccountPage,
    })),
  });
  await router.push('/activate-parent');
  const wrapper = mount(ParentAccountPage, {
    global: { plugins: [router], provide: { [sessionControllerKey as symbol]: controller } },
  });
  await flushPromises();
  const cleanup = () => {
    wrapper.unmount();
    controller.dispose();
  };
  cleanups.push(cleanup);
  return { wrapper, provider, verify, controller, refresh };
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.resetAllMocks();
});
describe('resumable pending-parent activation', () => {
  it.each(['conflict', 'network', 'renewal'])(
    'retries after consumed code and %s without verifying twice',
    async (failure) => {
      vi.mocked(activateParent)
        .mockResolvedValueOnce(error(ParentAccountError.unproven))
        .mockResolvedValueOnce(
          failure === 'conflict' ? error(ParentAccountError.conflict, true) : error('NETWORK'),
        )
        .mockResolvedValue({ kind: 'success' });
      const f = await fixture();
      expect(f.wrapper.find('input').exists()).toBe(true);
      await f.wrapper.get('input').setValue('consumed-code');
      if (failure === 'renewal') {
        f.provider.renew.mockRejectedValueOnce(new Error('renewal failed'));
        // No activation was sent while renewal failed.
        vi.mocked(activateParent).mockReset().mockResolvedValue({ kind: 'success' });
      }
      await f.wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(f.verify).toHaveBeenCalledTimes(1);
      expect(f.wrapper.find('input').exists()).toBe(false);
      expect(f.wrapper.text()).toContain('Retry activation');
      if (failure === 'conflict') {
        expect(f.refresh).toHaveBeenCalledWith(true);
        expect(activateParent).toHaveBeenCalledTimes(2); // Entry proof check, then explicit verification only.
      }
      await f.wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(f.verify).toHaveBeenCalledTimes(1);
      expect(activateParent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          credentials: expect.any(Function),
          isCurrent: expect.any(Function),
        }),
      );
      expect(f.refresh).toHaveBeenCalledWith(true);
    },
  );
  it('restores verified pending sessions by trying renewed-token activation without a code', async () => {
    vi.mocked(activateParent).mockResolvedValue({ kind: 'success' });
    const f = await fixture();
    expect(f.provider.renew).toHaveBeenCalledWith(true);
    expect(activateParent).toHaveBeenCalledTimes(1);
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.refresh).toHaveBeenCalledWith(true);
  });
  it('returns to verification only for server current-binding rejection', async () => {
    vi.mocked(activateParent).mockResolvedValue(error(ParentAccountError.conflict, true));
    const f = await fixture();
    expect(f.wrapper.find('input').exists()).toBe(false);
    vi.mocked(activateParent).mockResolvedValue(error(ParentAccountError.unproven));
    await f.wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(f.wrapper.find('input').exists()).toBe(true);
    expect(f.verify).not.toHaveBeenCalled();
  });
  it('discards late activation after sign-out', async () => {
    let finish!: (value: { kind: 'success' }) => void;
    vi.mocked(activateParent).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const f = await fixture();
    await f.controller.signOut();
    finish({ kind: 'success' });
    await flushPromises();
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.controller.state.value.kind).toBe('signed-out');
  });
});
