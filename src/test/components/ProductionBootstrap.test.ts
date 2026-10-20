import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';

enableAutoUnmount(afterEach);

const restoreSession = vi.fn();
const signIn = vi.fn();
const signOut = vi.fn();
const registerFirstParent = vi.fn();
const confirmRegistration = vi.fn();
const resendConfirmationCode = vi.fn();
const forgotPassword = vi.fn();
const confirmForgotPassword = vi.fn();
const getIdToken = vi.fn();
const requireIdToken = vi.fn();
class AuthSessionUnavailableError extends Error {}
const fetchCurrentMembership = vi.fn();
const createHousehold = vi.fn();
const fetchMyProfile = vi.fn();
const saveMyProfile = vi.fn();
const fetchFamilyMembers = vi.fn();
const createChild = vi.fn();
const resetChildPassword = vi.fn();

vi.mock('../../config/authConfig', () => ({
  loadAuthConfig: () => ({
    userPoolId: 'pool',
    clientId: 'client',
    registrationClientId: 'registration-client',
    region: 'us-east-1',
  }),
}));
vi.mock('../../services/authClient', () => ({
  AuthSessionUnavailableError,
  AuthClient: class {
    restoreSession = restoreSession;
    signIn = signIn;
    signOut = signOut;
    registerFirstParent = registerFirstParent;
    confirmRegistration = confirmRegistration;
    resendConfirmationCode = resendConfirmationCode;
    forgotPassword = forgotPassword;
    confirmForgotPassword = confirmForgotPassword;
    getIdToken = getIdToken;
    requireIdToken = requireIdToken;
  },
}));
vi.mock('../../services/householdClient', () => ({ fetchCurrentMembership, createHousehold }));
vi.mock('../../services/profileClient', () => ({
  fetchMyProfile,
  saveMyProfile,
  ProfileColor: { pine: 'PINE', lake: 'LAKE' },
  ProfileColorHex: { PINE: '#2F6B4F', LAKE: '#337B8C' },
}));
vi.mock('../../services/familyClient', () => ({
  fetchFamilyMembers,
  createChild,
  resetChildPassword,
}));

const { default: SessionRoot } = await import('../../components/SessionRoot.vue');
const { default: ProductionBootstrap } = await import('../../components/ProductionBootstrap.vue');
const { createAppRouter } = await import('../../router');
const { AuthClient } = await import('../../services/authClient');
const { createMemoryAuthStorage } = await import('../../session/authStorage');
const { createAuthSessionProvider } = await import('../../session/authSessionProvider');
const { createApplicationSession } = await import('../../session/appSession');
const { createSessionController } = await import('../../session/sessionController');
const { sessionControllerKey } = await import('../../session/injection');
let router: ReturnType<typeof createAppRouter>;
let session: ReturnType<typeof createApplicationSession>;
const { AppRouteName } = await import('../../router/routes');

function mountBootstrap(options: Record<string, unknown> = {}) {
  if (!router.currentRoute.value.name) void router.push({ name: AppRouteName.signIn });
  return mount(ProductionBootstrap, {
    global: { plugins: [router], provide: { [sessionControllerKey as symbol]: session } },
    ...options,
  });
}

const membership = {
  memberId: 'member-one',
  role: 'parent',
  household: {
    householdId: 'house-one',
    name: 'River House',
    timezone: 'America/Chicago',
  },
};

describe('ProductionBootstrap', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    restoreSession.mockResolvedValue(null);
    fetchCurrentMembership.mockResolvedValue({ kind: 'success', data: { membership: null } });
    fetchMyProfile.mockResolvedValue({ kind: 'success', data: { profile: null } });
    fetchFamilyMembers.mockResolvedValue({
      kind: 'success',
      data: {
        members: [
          {
            memberId: 'member-one',
            username: 'parent-one',
            role: 'parent',
            activationState: 'ACTIVE',
            displayName: 'River',
            color: 'PINE',
            allowedActions: [],
          },
        ],
      },
    });
    getIdToken.mockReturnValue('id-token');
    requireIdToken.mockReturnValue('id-token');
    const account = new AuthClient(
      {
        userPoolId: 'pool',
        clientId: 'client',
        registrationClientId: 'registration-client',
        region: 'us-east-1',
      },
      createMemoryAuthStorage(),
    );
    session = createApplicationSession({ provider: createAuthSessionProvider(account), account });
    router = createAppRouter(session, createMemoryHistory());
  });

  it('shows restoration without flashing signed-out content, then renders sign in', async () => {
    let finish: (value: null) => void = () => undefined;
    restoreSession.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const wrapper = mountBootstrap();
    expect(wrapper.text()).toContain('Restoring your private session');
    expect(wrapper.text()).not.toContain('Create first-parent account');
    finish(null);
    await flushPromises();
    expect(wrapper.get('h2').text()).toBe('Sign in');
  });

  it('restores the same-tab session and gates an unattached account at household creation', async () => {
    restoreSession.mockResolvedValue({
      idToken: 'restored-token',
      accessToken: 'access',
      expiresAt: new Date('2030-01-01'),
    });
    const wrapper = mountBootstrap();
    await flushPromises();
    expect(fetchCurrentMembership).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: expect.any(Function) }),
      expect.any(Function),
    );
    expect(wrapper.get('h2').text()).toBe('Create your household');
  });

  it('preserves the one-time legacy-upgrade explanation after page startup', async () => {
    const account = session.account;
    session = createSessionController({
      account,
      provider: {
        restore: async () => ({ kind: 'signed-out', reason: 'upgrade' }),
        signIn,
        signOut,
      },
      readContext: vi.fn(),
    });
    router = createAppRouter(session, createMemoryHistory());
    const wrapper = mountBootstrap();
    await flushPromises();
    expect(wrapper.text()).toContain('Sign in once more after this update.');
  });

  it('registers, clears secret fields, confirms email, and supports resend', async () => {
    registerFirstParent.mockResolvedValue({ kind: 'success' });
    confirmRegistration.mockResolvedValue({ kind: 'success' });
    resendConfirmationCode.mockResolvedValue({ kind: 'success' });
    const wrapper = mountBootstrap();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Create first-parent'))!
      .trigger('click');
    await flushPromises();
    await wrapper.get('input[autocomplete="username"]').setValue('ParentOne');
    await wrapper.get('input[autocomplete="email"]').setValue('parent@example.invalid');
    await wrapper.get('input[autocomplete="new-password"]').setValue('StrongPassword123!');
    await wrapper.get('input[autocomplete="off"]').setValue('gate-private');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(registerFirstParent).toHaveBeenCalledWith(
      'ParentOne',
      'StrongPassword123!',
      'parent@example.invalid',
      'gate-private',
    );
    expect(wrapper.get('h2').text()).toContain('Verify');
    await wrapper.get('button[type="button"]').trigger('click');
    await flushPromises();
    expect(resendConfirmationCode).toHaveBeenCalledWith('ParentOne');
    await wrapper.get('input[autocomplete="one-time-code"]').setValue('123456');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(confirmRegistration).toHaveBeenCalledWith('ParentOne', '123456');
    expect(wrapper.get('h2').text()).toBe('Sign in');
    expect(wrapper.find('input[autocomplete="off"]').exists()).toBe(false);
  });

  it('renders an accessible duplicate-username field conflict', async () => {
    registerFirstParent.mockResolvedValue({
      kind: 'error',
      field: 'username',
      message: 'That username is already in use.',
      recoverable: true,
    });
    const wrapper = mountBootstrap();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Create first-parent'))!
      .trigger('click');
    await flushPromises();
    for (const [selector, value] of [
      ['input[autocomplete="username"]', 'ParentOne'],
      ['input[autocomplete="email"]', 'parent@example.invalid'],
      ['input[autocomplete="new-password"]', 'StrongPassword123!'],
      ['input[autocomplete="off"]', 'gate-private'],
    ])
      await wrapper.get(selector).setValue(value);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('input[autocomplete="username"]').attributes('aria-invalid')).toBe('true');
    expect(wrapper.text()).toContain('already in use');
  });

  it('labels the registration gate as Entry Code and blocks weak account passwords', async () => {
    const wrapper = mountBootstrap({ attachTo: document.body });
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Create first-parent'))!
      .trigger('click');
    await flushPromises();
    await wrapper.get('input[autocomplete="username"]').setValue('ParentOne');
    await wrapper.get('input[autocomplete="email"]').setValue('parent@example.invalid');
    await wrapper.get('input[autocomplete="off"]').setValue('gate-private');
    await wrapper.get('input[autocomplete="new-password"]').setValue('weak');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const passwordField = wrapper.get('input[autocomplete="new-password"]');
    expect(wrapper.text()).toContain('Entry Code');
    expect(wrapper.text()).not.toContain('Registration password');
    expect(wrapper.text()).toContain(
      'including an uppercase letter, lowercase letter, number, and symbol',
    );
    expect(passwordField.attributes('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(passwordField.element);
    expect(registerFirstParent).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('creates a child from the canonical parent route and clears its password after submission', async () => {
    restoreSession.mockResolvedValue({
      idToken: 'token',
      accessToken: 'access',
      expiresAt: new Date('2030-01-01'),
    });
    fetchCurrentMembership.mockResolvedValue({ kind: 'success', data: { membership } });
    fetchMyProfile.mockResolvedValue({
      kind: 'success',
      data: {
        profile: { memberId: 'member-one', displayName: 'River', color: 'PINE', version: 1 },
      },
    });
    createChild.mockResolvedValue({
      kind: 'success',
      data: {
        member: {
          memberId: 'child-one',
          username: 'child-one',
          displayName: 'Child One',
          role: 'child',
          activationState: 'ACTIVE',
          color: 'PINE',
          allowedActions: [],
        },
      },
    });
    await router.push({ name: AppRouteName.newChild });
    const wrapper = mountBootstrap();
    await flushPromises();

    expect(wrapper.get('h2').text()).toBe('Create child account');
    await wrapper.get('input[autocomplete="username"]').setValue('Child-One');
    await wrapper.get('input[autocomplete="nickname"]').setValue('Child One');
    await wrapper.get('input[type="radio"]').setValue('PINE');
    const passwordField = wrapper.get('input[autocomplete="new-password"]');
    await passwordField.setValue('PrivatePassword1!');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(createChild).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: expect.any(Function) }),
      expect.objectContaining({
        username: 'child-one',
        displayName: 'Child One',
        color: 'PINE',
        password: 'PrivatePassword1!',
      }),
    );
    expect(wrapper.find('input[autocomplete="new-password"]').exists()).toBe(false);
    expect(router.currentRoute.value.name).toBe(AppRouteName.family);
  });

  async function openChildReset() {
    restoreSession.mockResolvedValue({
      idToken: 'token',
      accessToken: 'access',
      expiresAt: new Date('2030-01-01'),
    });
    fetchCurrentMembership.mockResolvedValue({ kind: 'success', data: { membership } });
    fetchMyProfile.mockResolvedValue({
      kind: 'success',
      data: {
        profile: {
          memberId: 'member-one',
          displayName: 'River',
          color: 'PINE',
          version: 1,
        },
      },
    });
    fetchFamilyMembers.mockResolvedValue({
      kind: 'success',
      data: {
        members: [
          {
            memberId: 'child',
            username: 'child-one',
            role: 'child',
            activationState: 'ACTIVE',
            displayName: 'Child One',
            color: 'PINE',
            allowedActions: [],
          },
          {
            memberId: 'child-two',
            username: 'child-two',
            role: 'child',
            activationState: 'ACTIVE',
            displayName: 'Child Two',
            color: 'PINE',
            allowedActions: [],
          },
        ],
      },
    });
    await router.push({ name: AppRouteName.resetChildPassword, params: { memberId: 'child' } });
    const wrapper = mountBootstrap({ attachTo: document.body });
    await flushPromises();
    return wrapper;
  }

  it('validates reset password accessibly and clears it after confirmed submission', async () => {
    const wrapper = await openChildReset();
    const field = wrapper.get('input[autocomplete="new-password"]');
    await field.setValue('weak');
    await wrapper.get('form').trigger('submit');
    expect(field.attributes('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field.element);
    expect(resetChildPassword).not.toHaveBeenCalled();
    resetChildPassword.mockResolvedValue({ kind: 'success' });
    await field.setValue('Replacement1!');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(resetChildPassword).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: expect.any(Function) }),
      'child',
      'Replacement1!',
    );
    expect(router.currentRoute.value.name).toBe(AppRouteName.family);
    expect(wrapper.text()).toContain('Child password reset.');
    wrapper.unmount();
  });

  it('clears reset secrets across same-route target changes and cancellation', async () => {
    const wrapper = await openChildReset();
    await wrapper.get('input[type="password"]').setValue('Replacement1!');
    await router.push({ name: AppRouteName.resetChildPassword, params: { memberId: 'child-two' } });
    await flushPromises();
    expect(wrapper.get('input[type="password"]').element.value).toBe('');
    await wrapper.get('input[type="password"]').setValue('Replacement1!');
    await wrapper.get('.form-actions a').trigger('click');
    await flushPromises();
    expect(resetChildPassword).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('blocks repeat submission after an uncertain reset outcome', async () => {
    const wrapper = await openChildReset();
    resetChildPassword.mockResolvedValue({
      kind: 'error',
      message: 'safe error',
      recoverable: false,
    });
    await wrapper.get('input[type="password"]').setValue('Replacement1!');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('input[type="password"]').element.value).toBe('');
    expect(wrapper.get('button[type="submit"]').attributes()).toHaveProperty('disabled');
    await wrapper.get('form').trigger('submit');
    expect(resetChildPassword).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it('redirects an unavailable reset target to the family directory', async () => {
    const wrapper = await openChildReset();
    await router.push({ name: AppRouteName.resetChildPassword, params: { memberId: 'absent' } });
    await flushPromises();
    expect(router.currentRoute.value.name).toBe(AppRouteName.family);
    expect(wrapper.find('input[type="password"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('offers generic Forgot Password initiation and completes recovery', async () => {
    forgotPassword.mockResolvedValue({ kind: 'success' });
    confirmForgotPassword.mockResolvedValue({ kind: 'success' });
    const wrapper = mountBootstrap();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Forgot'))!
      .trigger('click');
    await flushPromises();
    await wrapper.get('input[autocomplete="username"]').setValue('ParentOne');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('If the account is eligible');
    await wrapper.get('input[autocomplete="one-time-code"]').setValue('123456');
    await wrapper.get('input[autocomplete="new-password"]').setValue('NewStrongPassword123!');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(confirmForgotPassword).toHaveBeenCalledWith(
      'ParentOne',
      '123456',
      'NewStrongPassword123!',
    );
    expect(wrapper.get('h2').text()).toBe('Sign in');
  });

  it('shows the same password policy and focuses the recovery password after weak input', async () => {
    forgotPassword.mockResolvedValue({ kind: 'success' });
    const wrapper = mountBootstrap({ attachTo: document.body });
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Forgot'))!
      .trigger('click');
    await flushPromises();
    await wrapper.get('input[autocomplete="username"]').setValue('ParentOne');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    await wrapper.get('input[autocomplete="one-time-code"]').setValue('123456');
    await wrapper.get('input[autocomplete="new-password"]').setValue('weak');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    const passwordField = wrapper.get('input[autocomplete="new-password"]');
    expect(wrapper.text()).toContain(
      'including an uppercase letter, lowercase letter, number, and symbol',
    );
    expect(passwordField.attributes('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(passwordField.element);
    expect(confirmForgotPassword).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('validates household name with focus, then requires profile setup after creation', async () => {
    restoreSession.mockResolvedValue({
      idToken: 'token',
      accessToken: 'access',
      expiresAt: new Date('2030-01-01'),
    });
    createHousehold.mockResolvedValue({ kind: 'success', data: { membership } });
    const wrapper = mountBootstrap({ attachTo: document.body });
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const name = wrapper.get('input[maxlength="80"]');
    expect(name.attributes('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name.element);
    await name.setValue('River House');
    await wrapper.get('select').setValue('America/Chicago');
    fetchCurrentMembership.mockResolvedValue({ kind: 'success', data: { membership } });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(createHousehold).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: expect.any(Function) }),
      expect.objectContaining({ name: 'River House', timezone: 'America/Chicago' }),
    );
    expect(fetchMyProfile).not.toHaveBeenCalled();
    expect(session.state.value).toMatchObject({
      kind: 'ready',
      context: { kind: 'profile-required' },
    });
    expect(wrapper.get('h2').text()).toBe('Set up your profile');
    wrapper.unmount();
  });

  it('requires a display name and palette choice, then creates the first profile', async () => {
    restoreSession.mockResolvedValue({
      idToken: 'token',
      accessToken: 'access',
      expiresAt: new Date('2030-01-01'),
    });
    fetchCurrentMembership.mockResolvedValue({ kind: 'success', data: { membership } });
    saveMyProfile.mockResolvedValue({
      kind: 'success',
      data: {
        profile: { memberId: 'member-one', displayName: 'River', color: 'LAKE', version: 1 },
      },
    });
    const wrapper = mountBootstrap({ attachTo: document.body });
    await flushPromises();
    expect(wrapper.get('h2').text()).toBe('Set up your profile');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    const name = wrapper.get('input[autocomplete="nickname"]');
    expect(name.attributes('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(name.element);
    await name.setValue('River');
    await wrapper.get('input[value="LAKE"]').setValue();
    fetchMyProfile.mockResolvedValue({
      kind: 'success',
      data: {
        profile: { memberId: 'member-one', displayName: 'River', color: 'LAKE', version: 1 },
      },
    });
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(saveMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: expect.any(Function) }),
      {
        displayName: 'River',
        color: 'LAKE',
        version: 0,
      },
    );
    expect(wrapper.text()).toContain('Family management');
    wrapper.unmount();
  });

  it('offers an explicit retry when profile loading has a recoverable error', async () => {
    restoreSession.mockResolvedValue({
      idToken: 'token',
      accessToken: 'access',
      expiresAt: new Date('2030-01-01'),
    });
    fetchCurrentMembership.mockResolvedValue({ kind: 'success', data: { membership } });
    fetchMyProfile
      .mockResolvedValueOnce({ kind: 'error', message: 'Offline', recoverable: true })
      .mockResolvedValueOnce({ kind: 'success', data: { profile: null } });
    void router.push({ name: AppRouteName.signIn });
    const wrapper = mount(SessionRoot, {
      global: { plugins: [router], provide: { [sessionControllerKey as symbol]: session } },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('We couldn’t open your session');
    const initialProfileReads = fetchMyProfile.mock.calls.length;
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Retry')!
      .trigger('click');
    await flushPromises();
    expect(fetchMyProfile.mock.calls.length).toBeGreaterThan(initialProfileReads);
    expect(wrapper.get('h2').text()).toBe('Set up your profile');
  });

  it.each([false, true])(
    'renews Family Retry after expiry without sign-out (transient renewal failure: %s)',
    async (transientFailure) => {
      let now = Date.now();
      const credentials = {
        idToken: 'original-token',
        accessToken: 'access',
        expiresAt: new Date(now + 120_000),
      };
      const renew = vi.fn().mockImplementation(async () => ({
        kind: 'usable',
        credentials: {
          ...credentials,
          idToken: 'renewed-token',
          expiresAt: new Date(now + 3600_000),
        },
      }));
      if (transientFailure)
        renew.mockResolvedValueOnce({ kind: 'error', failure: 'provider-unavailable' });
      const providerSignOut = vi.fn();
      const previousSession = session;
      session = createSessionController({
        account: previousSession.account,
        provider: {
          restore: async () => ({ kind: 'usable', credentials }),
          renew,
          signIn: vi.fn(),
          signOut: providerSignOut,
        },
        clock: { now: () => now },
        foreground: () => false,
        readContext: async () => ({
          kind: 'success',
          context: {
            kind: 'active',
            membership: { ...membership, username: 'parent-one' },
            profile: { memberId: 'member-one', displayName: 'River', color: 'PINE', version: 1 },
          },
        }),
      });
      previousSession.dispose();
      const actualFamilyClient = await vi.importActual<
        typeof import('../../services/familyClient')
      >('../../services/familyClient');
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 503 }))
        .mockImplementation(
          async () => new Response(JSON.stringify({ members: [] }), { status: 200 }),
        );
      fetchFamilyMembers.mockImplementation((source) =>
        actualFamilyClient.fetchFamilyMembers(source, fetchImpl),
      );
      router = createAppRouter(session, createMemoryHistory());
      await router.push({ name: AppRouteName.family });
      const wrapper = mountBootstrap();
      await flushPromises();
      expect(wrapper.text()).toContain('Try again');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      now += 121_000;
      const retry = () =>
        wrapper
          .findAll('button')
          .find((button) => button.text() === 'Try again')!
          .trigger('click');
      await retry();
      await flushPromises();
      if (transientFailure) {
        expect(renew).toHaveBeenCalledTimes(1);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(session.state.value.kind).toBe('ready');
        expect(providerSignOut).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('Try again');
        await retry();
        await flushPromises();
      }
      expect(renew).toHaveBeenCalledTimes(transientFailure ? 2 : 1);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls[1]![1]).toMatchObject({
        headers: { authorization: 'Bearer renewed-token' },
        cache: 'no-store',
      });
      expect(providerSignOut).not.toHaveBeenCalled();
      expect(session.state.value.kind).toBe('ready');
      expect(wrapper.get('h2').text()).toBe('Family management');
      wrapper.unmount();
      session.dispose();
    },
  );

  it('renders the family directory and lets a member edit only their own profile', async () => {
    restoreSession.mockResolvedValue({
      idToken: 'token',
      accessToken: 'access',
      expiresAt: new Date('2030-01-01'),
    });
    fetchCurrentMembership.mockResolvedValue({ kind: 'success', data: { membership } });
    fetchMyProfile.mockResolvedValue({
      kind: 'success',
      data: {
        profile: { memberId: 'member-one', displayName: 'River', color: 'PINE', version: 1 },
      },
    });
    fetchFamilyMembers.mockResolvedValue({
      kind: 'success',
      data: {
        members: [
          {
            memberId: 'member-one',
            username: 'parent-one',
            role: 'parent',
            activationState: 'ACTIVE',
            displayName: 'River',
            color: 'PINE',
            allowedActions: [],
          },
        ],
      },
    });
    saveMyProfile.mockResolvedValue({
      kind: 'success',
      data: {
        profile: { memberId: 'member-one', displayName: 'River Two', color: 'LAKE', version: 2 },
      },
    });
    const wrapper = mountBootstrap();
    await flushPromises();
    expect(wrapper.text()).toContain('@parent-one');
    expect(wrapper.text()).not.toContain('Active');
    expect(wrapper.text()).not.toContain('Pine');
    await wrapper.get('.family-member__action').trigger('click');
    await flushPromises();
    expect(wrapper.get('.profile-color-preview').attributes('data-profile-color')).toBe('PINE');
    await wrapper.get('input[autocomplete="nickname"]').setValue('River Two');
    await wrapper.get('input[value="LAKE"]').setValue();
    expect(wrapper.get('.profile-color-preview').attributes('data-profile-color')).toBe('LAKE');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(saveMyProfile).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: expect.any(Function) }),
      {
        displayName: 'River Two',
        color: 'LAKE',
        version: 1,
      },
    );
    expect(wrapper.text()).toContain('Profile updated.');
  });

  it('keeps family actions beside the household heading rather than after the directory', async () => {
    restoreSession.mockResolvedValue({
      idToken: 'token',
      accessToken: 'access',
      expiresAt: new Date('2030-01-01'),
    });
    fetchCurrentMembership.mockResolvedValue({ kind: 'success', data: { membership } });
    fetchMyProfile.mockResolvedValue({
      kind: 'success',
      data: {
        profile: { memberId: 'member-one', displayName: 'River', color: 'PINE', version: 1 },
      },
    });
    fetchFamilyMembers.mockResolvedValue({
      kind: 'success',
      data: {
        members: [
          {
            memberId: 'member-one',
            username: 'parent-one',
            role: 'parent',
            activationState: 'ACTIVE',
            displayName: 'River',
            color: 'PINE',
            allowedActions: [],
          },
        ],
      },
    });
    const wrapper = mountBootstrap();
    await flushPromises();

    const actions = wrapper.get('.family-page__heading .family-page__actions');
    expect(actions.get('a').text()).toBe('Create child account');
    expect(actions.get('button').text()).toBe('Sign out');
    expect(
      wrapper
        .find('.family-page__heading')
        .element.compareDocumentPosition(wrapper.find('.family-directory').element),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('offers the runtime IANA timezone list instead of a curated subset', async () => {
    restoreSession.mockResolvedValue({
      idToken: 'token',
      accessToken: 'access',
      expiresAt: new Date('2030-01-01'),
    });
    const wrapper = mountBootstrap();
    await flushPromises();
    expect(wrapper.get('option[value="Africa/Abidjan"]').exists()).toBe(true);
  });

  it('clears private rendered state on sign-out', async () => {
    restoreSession.mockResolvedValue({
      idToken: 'token',
      accessToken: 'access',
      expiresAt: new Date('2030-01-01'),
    });
    fetchCurrentMembership.mockResolvedValue({ kind: 'success', data: { membership } });
    fetchMyProfile.mockResolvedValue({
      kind: 'success',
      data: {
        profile: { memberId: 'member-one', displayName: 'River', color: 'LAKE', version: 1 },
      },
    });
    fetchFamilyMembers.mockResolvedValue({ kind: 'success', data: { members: [] } });
    const wrapper = mountBootstrap();
    await flushPromises();
    expect(wrapper.text()).toContain('River House');
    restoreSession.mockResolvedValue(null);
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Sign out')!
      .trigger('click');
    await flushPromises();
    expect(signOut).toHaveBeenCalledOnce();
    expect(wrapper.text()).not.toContain('River House');
    expect(wrapper.get('h2').text()).toBe('Sign in');
  });
});
