<script setup lang="ts">
import ChildRemovalControl from './ChildRemovalControl.vue';
import PendingParentControls from './PendingParentControls.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import type { CredentialSource } from '../services/apiClient';
import {
  SessionCredentialsUnavailableError,
  SessionOperationCancelledError,
} from '../session/sessionErrors';
import { messages } from '../i18n/messages';
import { applyMembershipContext } from '../presentation/appContext';
import { applyProfileTone } from '../presentation/profileTone';
import { useSessionController } from '../session/injection';
import { meetsAccountPasswordPolicy } from '../services/accountPassword';
import { isValidUsername, normalizeUsernameForCognito } from '../services/username';
import { AuthSessionUnavailableError, type AuthActionResult } from '../services/authClient';
import { createHousehold, type CurrentMembership } from '../services/householdClient';
import {
  createChild,
  fetchFamilyMembers,
  resetChildPassword,
  type CreateChildInput,
  type CreateChildResult,
  type ResetChildPasswordResult,
  type FamilyMember,
} from '../services/familyClient';
import {
  ProfileColor,
  ProfileColorHex,
  saveMyProfile,
  type Profile,
  type ProfileColorId,
} from '../services/profileClient';
import {
  AppRouteName,
  bootstrapScreenForRoute,
  type AppRouteName as AppRouteNameType,
  type BootstrapPageScreen,
} from '../router/routes';

type TransientScreen =
  | 'restoring'
  | 'membership-loading'
  | 'profile-loading'
  | 'profile-load-error'
  | 'family-loading'
  | 'family-load-error';

type Screen = BootstrapPageScreen | TransientScreen;
type ChildFormInput = Omit<CreateChildInput, 'idempotencyKey'>;

const DEFAULT_TRANSIENT_SCREEN: TransientScreen = 'restoring';
const routeByAuthScreen = {
  signin: AppRouteName.signIn,
  register: AppRouteName.register,
  forgot: AppRouteName.forgotPassword,
} as const;

const route = useRoute();
const router = useRouter();
const session = useSessionController();
let pageIdentityVersion = session.identityVersion.value;
let disposed = false;
const initialState = session.state.value;
const initialContext = initialState.kind === 'ready' ? initialState.context : null;
function isPageCurrent() {
  return !disposed && pageIdentityVersion === session.identityVersion.value;
}
onBeforeUnmount(() => {
  disposed = true;
  clearSecrets();
  membership.value = null;
  profile.value = null;
  familyMembers.value = [];
  displayName.value = '';
  profileColor.value = '';
  householdName.value = '';
  username.value = '';
  email.value = '';
  clearChildForm();
});

const supportedTimezones = availableIanaTimezones();
const copy = messages.bootstrap;
const profileCopy = messages.profileSetup;
const familyCopy = messages.familyManagement;
const profileColors = Object.values(ProfileColor).map((color) => ({
  id: color,
  hex: ProfileColorHex[color],
  label: color.charAt(0) + color.slice(1).toLowerCase(),
}));
const transientScreen = ref<TransientScreen | null>(
  session.state.value.kind === 'ready' || session.state.value.kind === 'signed-out'
    ? null
    : DEFAULT_TRANSIENT_SCREEN,
);
const screen = computed<Screen>(() => {
  const routeName = (route.name ?? AppRouteName.signIn) as AppRouteNameType;
  return transientScreen.value ?? bootstrapScreenForRoute(routeName) ?? DEFAULT_TRANSIENT_SCREEN;
});
const busy = ref(false);
let initialStatus = '';
if (initialState.kind === 'signed-out') {
  if (initialState.reason === 'explicit') initialStatus = copy.signedOut;
  if (initialState.reason === 'upgrade') initialStatus = messages.session.upgradeHelp;
  if (initialState.reason === 'sign-out-incomplete')
    initialStatus = messages.session.signOutIncomplete;
  if (initialState.reason === 'ended' || initialState.reason === 'credentials-stale')
    initialStatus = copy.sessionEnded;
}
const status = ref(initialStatus);
const statusIsError = ref(false);
const username = ref('');
const password = ref('');
const email = ref('');
const gatePassword = ref('');
const code = ref('');
const newPassword = ref('');
const householdName = ref('');
const timezone = ref(browserTimezone());
const membership = ref<CurrentMembership | null>(
  (initialContext && initialContext.kind !== 'unattached' ? initialContext.membership : null) ??
    null,
);
const displayName = ref(
  (initialContext?.kind === 'active' ? initialContext.profile.displayName : undefined) ?? '',
);
const profileColor = ref<ProfileColorId | ''>(
  (initialContext?.kind === 'active' ? initialContext.profile.color : undefined) ?? '',
);
const profile = ref<Profile | null>(
  (initialContext?.kind === 'active' ? initialContext.profile : null) ?? null,
);
let profileDraftInitialized = initialContext?.kind === 'active';
const familyMembers = ref<FamilyMember[]>([]);
const childUsername = ref('');
const childDisplayName = ref('');
const childColor = ref<ProfileColorId | ''>('');
const childPassword = ref('');
const replacementChildPassword = ref('');
const childResetBlocked = ref(false);
const childProvisioningBlocked = ref(false);
const fieldError = ref<Record<string, string>>({});
const firstField = ref<{ focus(): void } | null>(null);
const registrationPasswordField = ref<{ focus(): void } | null>(null);
const resetPasswordField = ref<{ focus(): void } | null>(null);
const childUsernameField = ref<{ focus(): void } | null>(null);
const childPasswordField = ref<{ focus(): void } | null>(null);
const replacementChildPasswordField = ref<{ focus(): void } | null>(null);
const resetTarget = computed(() =>
  familyMembers.value.find(
    (member) =>
      member.memberId === route.params.memberId &&
      member.role === 'child' &&
      member.activationState === 'ACTIVE',
  ),
);
let idempotencyKey = globalThis.crypto.randomUUID();
let childIdempotencyKey = globalThis.crypto.randomUUID();

watch([householdName, timezone], () => {
  idempotencyKey = globalThis.crypto.randomUUID();
});

watch([childUsername, childDisplayName, childColor], () => {
  childIdempotencyKey = globalThis.crypto.randomUUID();
  childProvisioningBlocked.value = false;
});

watch(screen, (currentScreen) => {
  if (
    ['restoring', 'membership-loading', 'profile-loading', 'family-loading'].includes(currentScreen)
  ) {
    return;
  }
  void focusRouteHeading();
});

watch(
  () => route.fullPath,
  () => {
    clearSecrets();
    const routeName = route.name;
    if (routeName === AppRouteName.profile) prepareProfileEdit();
    if (
      routeName === AppRouteName.family &&
      !busy.value &&
      transientScreen.value === null &&
      session.state.value.kind === 'ready'
    ) {
      void run(async () => loadFamilyManagement(session.requestContext()));
    }
    if (routeName !== AppRouteName.newChild) clearChildForm();
    replacementChildPassword.value = '';
    childResetBlocked.value = false;
    fieldError.value = {};
    if (
      routeName === AppRouteName.resetChildPassword &&
      transientScreen.value === null &&
      !resetTarget.value
    ) {
      void navigate(AppRouteName.family, true);
    }
  },
);

watch(session.state, (state) => {
  if (!isPageCurrent()) return;
  if (state.kind === 'signed-out' && state.reason === 'explicit' && !status.value)
    status.value = copy.signedOut;
  if (state.kind === 'signed-out' && state.reason === 'sign-out-incomplete')
    status.value = messages.session.signOutIncomplete;
  if (state.kind !== 'ready') return;
  const previousProfile = profile.value;
  const hasDraft =
    previousProfile &&
    (displayName.value !== previousProfile.displayName ||
      profileColor.value !== previousProfile.color);
  membership.value = state.context.kind === 'unattached' ? null : state.context.membership;
  // Keep an unsaved draft's original version so background updates cannot silently
  // turn a stale edit into a last-write-wins save. Cancel adopts the latest context.
  if (hasDraft) return;
  profile.value = state.context.kind === 'active' ? state.context.profile : null;
  if (profile.value) {
    displayName.value = profile.value.displayName;
    profileColor.value = profile.value.color;
  }
});

onMounted(async () => {
  await session.initialize();
  if (!isPageCurrent()) return;
  if (session.state.value.kind === 'ready') await run(adoptSessionContext);
  else {
    transientScreen.value = null;
    const current = session.state.value;
    if (current.kind === 'signed-out') {
      if (current.reason === 'upgrade') status.value = messages.session.upgradeHelp;
      if (current.reason === 'explicit') status.value = copy.signedOut;
      if (current.reason === 'ended' || current.reason === 'credentials-stale')
        status.value = copy.sessionEnded;
      if (current.reason === 'sign-out-incomplete')
        status.value = messages.session.signOutIncomplete;
    }
  }
  await focusRouteHeading();
});

async function adoptSessionContext(): Promise<void> {
  if (!isPageCurrent()) return;
  const state = session.state.value;
  transientScreen.value = null;
  if (state.kind !== 'ready') return;
  const context = state.context;
  membership.value = context.kind === 'unattached' ? null : context.membership;
  profile.value = context.kind === 'active' ? context.profile : null;
  if (context.kind === 'unattached') {
    await navigate(AppRouteName.householdSetup, true);
    return;
  }
  if (context.kind === 'profile-required') {
    await navigate(AppRouteName.profileSetup, true);
    return;
  }
  await showResolvedProfile(session.requestContext());
}

async function signIn(): Promise<void> {
  await run(async () => {
    const result = await session.signIn(username.value, password.value);
    if (result.kind === 'cancelled' || disposed) return;
    if (result.kind === 'error') return showError(result);
    password.value = '';
    pageIdentityVersion = session.identityVersion.value;
    await adoptSessionContext();
  });
}

async function register(): Promise<void> {
  if (!(await validatePassword(password.value, registrationPasswordField))) return;
  await run(async () => {
    const result = await client().registerFirstParent(
      username.value,
      password.value,
      email.value,
      gatePassword.value,
    );
    if (result.kind === 'error') return showError(result);
    password.value = '';
    gatePassword.value = '';
    code.value = '';
    status.value = copy.checkEmail;
    statusIsError.value = false;
    await navigate(AppRouteName.verifyEmail);
  });
}

async function confirm(): Promise<void> {
  await run(async () => {
    const result = await client().confirmRegistration(username.value, code.value);
    if (result.kind === 'error') return showError(result);
    code.value = '';
    status.value = copy.emailVerified;
    statusIsError.value = false;
    await navigate(AppRouteName.signIn);
  });
}

async function resend(): Promise<void> {
  await run(async () => {
    const result = await client().resendConfirmationCode(username.value);
    if (result.kind === 'error') return showError(result);
    status.value = copy.codeResent;
    statusIsError.value = false;
  });
}

async function startRecovery(): Promise<void> {
  await run(async () => {
    const result = await client().forgotPassword(username.value);
    if (result.kind === 'error') return showError(result);
    status.value = copy.recoverySent;
    statusIsError.value = false;
    await navigate(AppRouteName.resetPassword);
  });
}

async function finishRecovery(): Promise<void> {
  if (!(await validatePassword(newPassword.value, resetPasswordField))) return;
  await run(async () => {
    const result = await client().confirmForgotPassword(
      username.value,
      code.value,
      newPassword.value,
    );
    if (result.kind === 'error') return showError(result);
    code.value = '';
    newPassword.value = '';
    status.value = copy.passwordReset;
    statusIsError.value = false;
    await navigate(AppRouteName.signIn);
  });
}

async function showResolvedProfile(idToken: CredentialSource): Promise<void> {
  if (!profile.value) return;
  applyProfileTone(profile.value.color);
  if (membership.value?.role === 'child' && route.name !== AppRouteName.profile) {
    await clearTransientScreenAndNavigate(AppRouteName.todos);
    return;
  }
  if (route.name === AppRouteName.newChild) {
    transientScreen.value = null;
    return;
  }
  if (route.name === AppRouteName.resetChildPassword) {
    await loadFamilyManagement(idToken, true);
    return;
  }
  if (route.name === AppRouteName.profile) {
    displayName.value = profile.value.displayName;
    profileColor.value = profile.value.color;
    transientScreen.value = null;
    return;
  }
  await loadFamilyManagement(idToken);
}

async function loadFamilyManagement(
  idToken: CredentialSource,
  preserveRoute = false,
): Promise<void> {
  const requestedRoute = route.fullPath;
  const readingCurrentFamilyRoute =
    route.name === AppRouteName.family || route.name === AppRouteName.resetChildPassword;
  transientScreen.value = 'family-loading';
  const result = await fetchFamilyMembers(idToken);
  if (!isPageCurrent()) return;
  // An existing Family read must not override Back/Forward. Onboarding can
  // deliberately resolve into Family while its first directory read is pending.
  if (readingCurrentFamilyRoute && route.fullPath !== requestedRoute) {
    transientScreen.value = null;
    return;
  }
  if (result.kind === 'error') {
    if (!result.recoverable) {
      signOut(result.message);
      return;
    }
    status.value = familyCopy.loadFailed;
    statusIsError.value = true;
    transientScreen.value = 'family-load-error';
    return;
  }
  familyMembers.value = result.data.members;
  transientScreen.value = null;
  if (preserveRoute && !resetTarget.value) {
    status.value = messages.membershipApi.targetNotFound;
    statusIsError.value = true;
    await navigate(AppRouteName.family, true);
    return;
  }
  if (!preserveRoute && route.name !== AppRouteName.family) {
    await navigate(AppRouteName.family, true);
  }
}

async function submitChildPasswordReset(): Promise<void> {
  if (busy.value || childResetBlocked.value) return;
  fieldError.value = {};
  const target = resetTarget.value;
  if (!target) {
    await navigate(AppRouteName.family, true);
    return;
  }
  if (!(await validatePassword(replacementChildPassword.value, replacementChildPasswordField)))
    return;
  await run(async () => applyChildPasswordReset(target.memberId));
}

async function applyChildPasswordReset(memberId: string): Promise<void> {
  const token = session.requestContext();
  const result = await resetChildPassword(token, memberId, replacementChildPassword.value);
  replacementChildPassword.value = '';
  if (!isPageCurrent()) return;
  if (result.kind === 'error') {
    await showChildResetError(result);
    return;
  }
  status.value = familyCopy.childPasswordReset;
  statusIsError.value = false;
  await loadFamilyManagement(token);
}

async function showChildResetError(
  result: Extract<ResetChildPasswordResult, { kind: 'error' }>,
): Promise<void> {
  if (result.sessionExpired) {
    signOut(copy.sessionEnded);
    return;
  }
  for (const error of result.fieldErrors ?? []) fieldError.value[error.field] = error.message;
  status.value = result.recoverable ? result.message : familyCopy.resetUnavailable;
  childResetBlocked.value = !result.recoverable;
  statusIsError.value = true;
  if (fieldError.value.password) {
    await nextTick();
    replacementChildPasswordField.value?.focus();
  }
}

async function submitHousehold(): Promise<void> {
  fieldError.value = {};
  if (!householdName.value.trim()) {
    fieldError.value.name = copy.nameRequired;
    await focusFirstField();
    return;
  }
  if (!timezone.value) {
    fieldError.value.timezone = copy.timezoneRequired;
    return;
  }
  await run(async () => {
    const token = session.requestContext();
    const result = await createHousehold(token, {
      name: householdName.value,
      timezone: timezone.value,
      idempotencyKey,
    });
    if (!isPageCurrent()) return;
    if (result.kind === 'error') {
      for (const error of result.fieldErrors ?? []) fieldError.value[error.field] = error.message;
      status.value = result.message;
      statusIsError.value = true;
      if (result.fieldErrors?.length) await focusFirstField();
      if (!result.recoverable) signOut(result.message);
      return;
    }
    membership.value = result.data.membership;
    session.applyConfirmedMembership(membership.value);
    applyMembershipContext(membership.value);
    status.value = copy.created;
    statusIsError.value = false;
    await adoptSessionContext();
  });
}

async function submitProfile(): Promise<void> {
  fieldError.value = {};
  const trimmedDisplayName = displayName.value.trim();
  if (!trimmedDisplayName) fieldError.value.displayName = profileCopy.displayNameRequired;
  if (!profileColor.value) fieldError.value.color = profileCopy.colorRequired;
  if (Object.keys(fieldError.value).length) {
    status.value = messages.profileApi.invalidDisplayName;
    statusIsError.value = true;
    await focusFirstField();
    return;
  }
  await run(async () => {
    const token = session.requestContext();
    const result = await saveMyProfile(token, {
      displayName: trimmedDisplayName,
      color: profileColor.value as ProfileColorId,
      version: profile.value?.version ?? 0,
    });
    if (!isPageCurrent()) return;
    if (result.kind === 'error') {
      for (const error of result.fieldErrors ?? []) fieldError.value[error.field] = error.message;
      status.value = result.message;
      statusIsError.value = true;
      if (!result.recoverable) signOut(result.message);
      return;
    }
    profile.value = result.data.profile;
    session.applyConfirmedProfile(profile.value);
    status.value =
      route.name === AppRouteName.profile ? familyCopy.profileSaved : profileCopy.saved;
    statusIsError.value = false;
    if (membership.value?.role === 'child') {
      await navigate(AppRouteName.todos, true);
      return;
    }
    await loadFamilyManagement(token);
  });
}

async function retryProfile(): Promise<void> {
  await run(async () => {
    await session.initialize();
    await adoptSessionContext();
  });
}

function prepareProfileEdit(): void {
  if (!profile.value) return;
  if (
    profileDraftInitialized &&
    (displayName.value !== profile.value.displayName || profileColor.value !== profile.value.color)
  )
    return;
  displayName.value = profile.value.displayName;
  profileColor.value = profile.value.color;
  profileDraftInitialized = true;
  fieldError.value = {};
}

async function retryFamilyManagement(): Promise<void> {
  await run(async () =>
    loadFamilyManagement(session.requestContext(), route.name === AppRouteName.resetChildPassword),
  );
}

async function submitChild(): Promise<void> {
  const input = await validatedChildInput();
  if (!input) return;
  await run(async () => provisionChild(input));
}

async function validatedChildInput(): Promise<ChildFormInput | null> {
  fieldError.value = {};
  const username = normalizeUsernameForCognito(childUsername.value);
  const displayName = childDisplayName.value.trim();
  if (!isValidUsername(username)) fieldError.value.username = copy.usernamePolicyError;
  if (!displayName) fieldError.value.displayName = profileCopy.displayNameRequired;
  if (!childColor.value) fieldError.value.color = profileCopy.colorRequired;
  if (!meetsAccountPasswordPolicy(childPassword.value))
    fieldError.value.password = copy.passwordPolicyError;
  if (Object.keys(fieldError.value).length) {
    await showChildValidationFailure();
    return null;
  }
  return {
    username,
    displayName,
    color: childColor.value as ProfileColorId,
    password: childPassword.value,
  };
}

async function showChildValidationFailure(): Promise<void> {
  status.value = copy.passwordPolicyError;
  statusIsError.value = true;
  await nextTick();
  if (fieldError.value.username) childUsernameField.value?.focus();
  else if (fieldError.value.password) childPasswordField.value?.focus();
}

async function provisionChild(input: ChildFormInput): Promise<void> {
  const token = session.requestContext();
  const result = await createChild(token, { ...input, idempotencyKey: childIdempotencyKey });
  childPassword.value = '';
  if (!isPageCurrent()) return;
  if (result.kind === 'error') {
    await showChildProvisioningError(result);
    return;
  }
  status.value = familyCopy.childCreated;
  statusIsError.value = false;
  clearChildForm();
  await loadFamilyManagement(token);
}

async function showChildProvisioningError(
  result: Extract<CreateChildResult, { kind: 'error' }>,
): Promise<void> {
  for (const error of result.fieldErrors ?? []) fieldError.value[error.field] = error.message;
  childProvisioningBlocked.value = !result.recoverable;
  status.value = result.recoverable ? result.message : familyCopy.provisioningUnavailable;
  statusIsError.value = true;
  if (fieldError.value.username) {
    await nextTick();
    childUsernameField.value?.focus();
  }
}

function cancelProfileEdit(): void {
  const state = session.state.value;
  if (state.kind === 'ready' && state.context.kind === 'active')
    profile.value = state.context.profile;
  if (profile.value) {
    displayName.value = profile.value.displayName;
    profileColor.value = profile.value.color;
  }
  fieldError.value = {};
}

function clearChildForm(): void {
  childUsername.value = '';
  childDisplayName.value = '';
  childColor.value = '';
  childPassword.value = '';
  childProvisioningBlocked.value = false;
}

function signOut(message = copy.signedOut): void {
  session.signOut();
  pageIdentityVersion = session.identityVersion.value;
  clearPrivateState(message);
}

function clearPrivateState(message: string): void {
  membership.value = null;
  applyMembershipContext(null);
  password.value = '';
  gatePassword.value = '';
  code.value = '';
  newPassword.value = '';
  householdName.value = '';
  displayName.value = '';
  profileColor.value = '';
  profile.value = null;
  familyMembers.value = [];
  clearChildForm();
  replacementChildPassword.value = '';
  childResetBlocked.value = false;
  username.value = '';
  email.value = '';
  fieldError.value = {};
  status.value = message;
  statusIsError.value = false;
  void clearTransientScreenAndNavigate(AppRouteName.signIn);
}

function chooseScreen(next: Extract<BootstrapPageScreen, 'signin' | 'register' | 'forgot'>): void {
  fieldError.value = {};
  status.value = '';
  statusIsError.value = false;
  password.value = '';
  gatePassword.value = '';
  code.value = '';
  newPassword.value = '';
  clearChildForm();
  void navigate(routeByAuthScreen[next]);
}

async function navigate(routeName: AppRouteNameType, replace = false): Promise<void> {
  if (!isPageCurrent() || route.name === routeName) return;
  if (replace) await router.replace({ name: routeName });
  else await router.push({ name: routeName });
}

async function clearTransientScreenAndNavigate(routeName: AppRouteNameType): Promise<void> {
  transientScreen.value = null;
  await navigate(routeName, true);
}

async function run(action: () => Promise<void>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  fieldError.value = {};
  status.value = '';
  statusIsError.value = false;
  try {
    await action();
  } catch (error) {
    if (!isPageCurrent()) return;
    if (error instanceof SessionOperationCancelledError) return;
    if (error instanceof SessionCredentialsUnavailableError) {
      status.value = messages.generic.networkError;
      statusIsError.value = true;
      return;
    }
    if (error instanceof AuthSessionUnavailableError) {
      signOut(copy.sessionEnded);
      return;
    }
    status.value = messages.generic.unexpectedError;
    statusIsError.value = true;
  } finally {
    busy.value = false;
  }
}

function showError(result: Extract<AuthActionResult, { kind: 'error' }>): void {
  status.value = result.message;
  statusIsError.value = true;
  if (result.field) fieldError.value[result.field] = result.message;
}

async function validatePassword(
  candidate: string,
  passwordField: { value: { focus(): void } | null },
): Promise<boolean> {
  if (meetsAccountPasswordPolicy(candidate)) return true;
  fieldError.value.password = copy.passwordPolicyError;
  status.value = copy.passwordPolicyError;
  statusIsError.value = true;
  await nextTick();
  passwordField.value?.focus();
  return false;
}

const SESSION_ACCOUNT_ADAPTER_MISSING = 'SESSION_ACCOUNT_ADAPTER_MISSING';
function client() {
  if (!session.account) throw new Error(SESSION_ACCOUNT_ADAPTER_MISSING);
  return session.account;
}

function clearSecrets(): void {
  password.value = '';
  gatePassword.value = '';
  code.value = '';
  newPassword.value = '';
  childPassword.value = '';
  replacementChildPassword.value = '';
}

function browserTimezone(): string {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return detected?.includes('/') ? detected : '';
  } catch {
    return '';
  }
}

function availableIanaTimezones(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch {
    // The selected browser timezone remains a valid fallback for older engines.
  }
  const detected = browserTimezone();
  return detected ? [detected] : [];
}

async function focusFirstField(): Promise<void> {
  await nextTick();
  firstField.value?.focus();
}

async function focusRouteHeading(): Promise<void> {
  await nextTick();
  const heading = globalThis.document.querySelector('#main-content h2');
  if (!heading || !(heading instanceof globalThis.HTMLElement)) return;
  heading.tabIndex = -1;
  heading.focus();
}
</script>

<template>
  <section
    :class="
      screen === 'family-management' ||
      screen === 'family-loading' ||
      screen === 'family-load-error'
        ? 'bootstrap-page bootstrap-page--directory'
        : 'bootstrap-form-surface surface-card mx-auto max-w-xl p-5 sm:p-8'
    "
  >
    <div class="min-h-6" role="status" aria-live="polite">
      <p
        v-if="status"
        class="status-region text-sm"
        :class="{
          'status-region--error': statusIsError,
          'status-region--populated': status,
        }"
      >
        {{ status }}
      </p>
    </div>

    <div
      v-if="
        screen === 'restoring' || screen === 'membership-loading' || screen === 'profile-loading'
      "
      aria-busy="true"
    >
      <h2 class="page-heading text-xl">{{ copy.restoreHeading }}</h2>
      <p class="body-muted mt-2">{{ copy.restoring }}</p>
    </div>

    <form v-else-if="screen === 'signin'" class="space-y-4" @submit.prevent="signIn">
      <h2 class="page-heading text-xl">{{ copy.signIn }}</h2>
      <label class="block"
        >{{ copy.username
        }}<input v-model="username" required autocomplete="username" class="field" :disabled="busy"
      /></label>
      <label class="block"
        >Password<input
          v-model="password"
          required
          type="password"
          autocomplete="current-password"
          class="field"
          :disabled="busy"
      /></label>
      <button class="primary" type="submit" :disabled="busy">
        {{ busy ? copy.signingIn : copy.signIn }}
      </button>
      <div class="flex flex-wrap gap-3 text-sm">
        <button type="button" class="link" @click="chooseScreen('register')">
          {{ copy.createFirstParent }}
        </button>
        <button type="button" class="link" @click="chooseScreen('forgot')">
          {{ copy.forgotPassword }}
        </button>
      </div>
    </form>

    <form v-else-if="screen === 'register'" class="space-y-4" @submit.prevent="register">
      <h2 class="page-heading text-xl">{{ copy.createParent }}</h2>
      <label class="block"
        >Username<input
          v-model="username"
          required
          autocomplete="username"
          class="field"
          :aria-invalid="!!fieldError.username"
        /><span v-if="fieldError.username" class="error">{{ fieldError.username }}</span></label
      >
      <label class="block"
        >{{ copy.recoveryEmail
        }}<input v-model="email" required type="email" autocomplete="email" class="field"
      /></label>
      <label class="block"
        >{{ copy.password
        }}<input
          ref="registrationPasswordField"
          v-model="password"
          required
          type="password"
          autocomplete="new-password"
          class="field"
          :aria-invalid="!!fieldError.password"
          aria-describedby="registration-password-policy registration-password-error"
      /></label>
      <span id="registration-password-policy" class="body-muted mt-1 block text-sm">{{
        copy.passwordPolicy
      }}</span>
      <span id="registration-password-error" class="error">{{ fieldError.password }}</span>
      <label class="block"
        >{{ copy.entryCode
        }}<input
          v-model="gatePassword"
          required
          type="password"
          autocomplete="off"
          class="field"
          :aria-invalid="!!fieldError.registrationGatePassword"
          aria-describedby="entry-code-help entry-code-error"
        /><span id="entry-code-help" class="body-muted mt-1 block text-sm">{{
          copy.entryCodeHelp
        }}</span
        ><span id="entry-code-error" class="error">{{
          fieldError.registrationGatePassword
        }}</span></label
      >
      <button class="primary" type="submit" :disabled="busy">
        {{ busy ? copy.creatingAccount : copy.createAccount }}
      </button>
      <button type="button" class="link" @click="chooseScreen('signin')">
        {{ copy.backToSignIn }}
      </button>
    </form>

    <form v-else-if="screen === 'confirm'" class="space-y-4" @submit.prevent="confirm">
      <h2 class="page-heading text-xl">{{ copy.verifyEmail }}</h2>
      <p class="body-muted text-sm">{{ copy.verificationHelp }}</p>
      <label class="block"
        >{{ copy.username
        }}<input v-model="username" required autocomplete="username" class="field"
      /></label>
      <label class="block"
        >Verification code<input
          v-model="code"
          required
          inputmode="numeric"
          autocomplete="one-time-code"
          class="field"
          :aria-invalid="!!fieldError.code"
        /><span v-if="fieldError.code" class="error">{{ fieldError.code }}</span></label
      >
      <button class="primary" type="submit" :disabled="busy">{{ copy.verifyEmailAction }}</button>
      <button type="button" class="link" :disabled="busy" @click="resend">
        {{ copy.resendCode }}
      </button>
    </form>

    <form v-else-if="screen === 'forgot'" class="space-y-4" @submit.prevent="startRecovery">
      <h2 class="page-heading text-xl">{{ copy.resetPassword }}</h2>
      <label class="block"
        >Username<input v-model="username" required autocomplete="username" class="field"
      /></label>
      <button class="primary" type="submit" :disabled="busy">{{ copy.sendRecoveryCode }}</button>
      <button type="button" class="link" @click="chooseScreen('signin')">
        {{ copy.backToSignIn }}
      </button>
    </form>

    <form v-else-if="screen === 'reset'" class="space-y-4" @submit.prevent="finishRecovery">
      <h2 class="page-heading text-xl">{{ copy.choosePassword }}</h2>
      <label class="block"
        >{{ copy.username
        }}<input v-model="username" required autocomplete="username" class="field"
      /></label>
      <label class="block"
        >{{ copy.recoveryCode
        }}<input
          v-model="code"
          required
          autocomplete="one-time-code"
          class="field"
          :aria-invalid="!!fieldError.code"
      /></label>
      <label class="block"
        >{{ copy.newPassword
        }}<input
          ref="resetPasswordField"
          v-model="newPassword"
          required
          type="password"
          autocomplete="new-password"
          class="field"
          :aria-invalid="!!fieldError.password"
          aria-describedby="reset-password-policy reset-password-error"
      /></label>
      <span id="reset-password-policy" class="body-muted mt-1 block text-sm">{{
        copy.passwordPolicy
      }}</span>
      <span id="reset-password-error" class="error">{{ fieldError.password }}</span>
      <button class="primary" type="submit" :disabled="busy">{{ copy.resetPasswordAction }}</button>
    </form>

    <form v-else-if="screen === 'household'" class="space-y-4" @submit.prevent="submitHousehold">
      <h2 class="page-heading text-xl">{{ copy.createHousehold }}</h2>
      <p class="body-muted text-sm">{{ copy.householdHelp }}</p>
      <label class="block"
        >Household name<input
          ref="firstField"
          v-model="householdName"
          required
          maxlength="80"
          class="field"
          :aria-invalid="!!fieldError.name"
          aria-describedby="household-name-error"
        /><span id="household-name-error" class="error">{{ fieldError.name }}</span></label
      >
      <label class="block"
        >Household timezone<select
          v-model="timezone"
          required
          class="field"
          :aria-invalid="!!fieldError.timezone"
        >
          <option value="" disabled>{{ copy.selectTimezone }}</option>
          <option v-if="timezone && !supportedTimezones.includes(timezone)" :value="timezone">
            {{ timezone }}
          </option>
          <option v-for="zone in supportedTimezones" :key="zone" :value="zone">
            {{ zone }}
          </option></select
        ><span class="error">{{ fieldError.timezone }}</span></label
      >
      <button class="primary" type="submit" :disabled="busy">
        {{ busy ? copy.creatingHousehold : copy.createHouseholdAction }}
      </button>
      <button type="button" class="link" @click="signOut()">{{ copy.signOut }}</button>
    </form>

    <div v-else-if="screen === 'profile-load-error'" class="space-y-4">
      <h2 class="page-heading text-xl">{{ profileCopy.heading }}</h2>
      <p class="body-secondary">{{ profileCopy.loadFailed }}</p>
      <button type="button" class="primary" @click="retryProfile">{{ profileCopy.retry }}</button>
      <button type="button" class="link" @click="signOut()">{{ copy.signOut }}</button>
    </div>

    <form
      v-else-if="screen === 'profile-setup' || screen === 'profile-edit'"
      class="space-y-5"
      @submit.prevent="submitProfile"
    >
      <h2 class="page-heading text-xl">
        {{ screen === 'profile-edit' ? familyCopy.editProfile : profileCopy.heading }}
      </h2>
      <p class="body-muted text-sm">{{ profileCopy.help }}</p>
      <label class="block"
        >{{ profileCopy.displayName
        }}<input
          ref="firstField"
          v-model="displayName"
          required
          maxlength="60"
          autocomplete="nickname"
          class="field"
          :disabled="busy"
          :aria-invalid="!!fieldError.displayName"
          aria-describedby="profile-display-name-error"
        /><span id="profile-display-name-error" class="error">{{
          fieldError.displayName
        }}</span></label
      >
      <div class="profile-color-preview" :data-profile-color="profileColor || undefined">
        <fieldset
          class="profile-color-preview__fieldset"
          :aria-describedby="fieldError.color ? 'profile-color-error' : undefined"
        >
          <legend class="body-strong font-medium">{{ profileCopy.color }}</legend>
          <div class="profile-color-options mt-2">
            <label
              v-for="color in profileColors"
              :key="color.id"
              class="profile-color-option"
              :class="{ 'profile-color-option--selected': profileColor === color.id }"
            >
              <input
                v-model="profileColor"
                type="radio"
                name="profile-color"
                :value="color.id"
                :disabled="busy"
              />
              <span
                class="profile-color-swatch"
                :style="{ backgroundColor: color.hex }"
                aria-hidden="true"
              />
              <span class="profile-color-option__label">{{ color.label }}</span>
            </label>
          </div>
          <span id="profile-color-error" class="error">{{ fieldError.color }}</span>
        </fieldset>
      </div>
      <div class="form-actions">
        <button class="primary" type="submit" :disabled="busy">
          {{
            busy
              ? profileCopy.saving
              : screen === 'profile-edit'
                ? familyCopy.saveProfile
                : profileCopy.save
          }}
        </button>
        <RouterLink
          v-if="screen === 'profile-edit'"
          :to="{ name: membership?.role === 'child' ? AppRouteName.todos : AppRouteName.family }"
          class="link inline-flex items-center"
          :aria-disabled="busy"
          :tabindex="busy ? -1 : undefined"
          @click="busy ? $event.preventDefault() : cancelProfileEdit()"
        >
          {{ familyCopy.cancel }}
        </RouterLink>
        <button v-else type="button" class="link" :disabled="busy" @click="signOut()">
          {{ copy.signOut }}
        </button>
      </div>
    </form>

    <div v-else-if="screen === 'family-loading'" aria-busy="true">
      <h2 class="page-heading text-xl">{{ familyCopy.heading }}</h2>
      <p class="body-muted mt-2">{{ familyCopy.loading }}</p>
    </div>

    <div v-else-if="screen === 'family-load-error'" class="space-y-4">
      <h2 class="page-heading text-xl">{{ familyCopy.heading }}</h2>
      <p class="body-secondary">{{ familyCopy.loadFailed }}</p>
      <button type="button" class="primary" @click="retryFamilyManagement">
        {{ familyCopy.retry }}
      </button>
      <button type="button" class="link" @click="signOut()">{{ copy.signOut }}</button>
    </div>

    <form
      v-else-if="screen === 'child-password-reset' && resetTarget"
      class="space-y-5"
      @submit.prevent="submitChildPasswordReset"
    >
      <h2 class="page-heading text-xl">{{ familyCopy.resetChildPassword }}</h2>
      <p class="body-muted text-sm">{{ resetTarget.displayName }} · @{{ resetTarget.username }}</p>
      <p class="body-muted text-sm">{{ familyCopy.resetChildPasswordHelp }}</p>
      <label class="block"
        >{{ copy.newPassword
        }}<input
          ref="replacementChildPasswordField"
          v-model="replacementChildPassword"
          required
          type="password"
          autocomplete="new-password"
          class="field"
          :disabled="busy || childResetBlocked"
          :aria-invalid="!!fieldError.password"
          aria-describedby="reset-child-password-policy reset-child-password-error"
      /></label>
      <span id="reset-child-password-policy" class="body-muted -mt-3 block text-sm">{{
        copy.passwordPolicy
      }}</span>
      <span id="reset-child-password-error" class="error">{{ fieldError.password }}</span>
      <div class="form-actions">
        <button class="primary" type="submit" :disabled="busy || childResetBlocked">
          {{ busy ? familyCopy.resettingChildPassword : familyCopy.resetChildPasswordAction }}
        </button>
        <RouterLink
          :to="{ name: AppRouteName.family }"
          class="link inline-flex items-center"
          :aria-disabled="busy"
          :tabindex="busy ? -1 : undefined"
          @click="busy ? $event.preventDefault() : undefined"
        >
          {{ familyCopy.cancel }}
        </RouterLink>
      </div>
    </form>

    <form v-else-if="screen === 'child-create'" class="space-y-5" @submit.prevent="submitChild">
      <h2 class="page-heading text-xl">{{ familyCopy.createChild }}</h2>
      <p class="body-muted text-sm">{{ familyCopy.createChildHelp }}</p>
      <label class="block"
        >{{ copy.username
        }}<input
          ref="childUsernameField"
          v-model="childUsername"
          required
          minlength="3"
          maxlength="24"
          autocomplete="username"
          class="field"
          :disabled="busy || childProvisioningBlocked"
          :aria-invalid="!!fieldError.username"
          aria-describedby="child-username-error"
        /><span id="child-username-error" class="error">{{ fieldError.username }}</span></label
      >
      <label class="block"
        >{{ familyCopy.childDisplayName
        }}<input
          v-model="childDisplayName"
          required
          maxlength="60"
          autocomplete="nickname"
          class="field"
          :disabled="busy || childProvisioningBlocked"
          :aria-invalid="!!fieldError.displayName"
        /><span class="error">{{ fieldError.displayName }}</span></label
      >
      <div class="profile-color-preview" :data-profile-color="childColor || undefined">
        <fieldset class="profile-color-preview__fieldset">
          <legend class="body-strong font-medium">{{ profileCopy.color }}</legend>
          <div class="profile-color-options mt-2">
            <label
              v-for="color in profileColors"
              :key="color.id"
              class="profile-color-option"
              :class="{ 'profile-color-option--selected': childColor === color.id }"
            >
              <input
                v-model="childColor"
                type="radio"
                name="child-profile-color"
                :value="color.id"
                :disabled="busy || childProvisioningBlocked"
              />
              <span
                class="profile-color-swatch"
                :style="{ backgroundColor: color.hex }"
                aria-hidden="true"
              />
              <span class="profile-color-option__label">{{ color.label }}</span>
            </label>
          </div>
          <span class="error">{{ fieldError.color }}</span>
        </fieldset>
      </div>
      <label class="block"
        >{{ familyCopy.childPassword
        }}<input
          ref="childPasswordField"
          v-model="childPassword"
          required
          type="password"
          autocomplete="new-password"
          class="field"
          :disabled="busy || childProvisioningBlocked"
          :aria-invalid="!!fieldError.password"
          aria-describedby="child-password-policy child-password-error"
      /></label>
      <span id="child-password-policy" class="body-muted -mt-3 block text-sm">{{
        copy.passwordPolicy
      }}</span>
      <span id="child-password-error" class="error">{{ fieldError.password }}</span>
      <div class="form-actions">
        <button class="primary" type="submit" :disabled="busy || childProvisioningBlocked">
          {{ busy ? familyCopy.creatingChild : familyCopy.createChildAction }}
        </button>
        <RouterLink
          :to="{ name: AppRouteName.family }"
          class="link inline-flex items-center"
          :aria-disabled="busy"
          :tabindex="busy ? -1 : undefined"
          @click="busy ? $event.preventDefault() : clearChildForm()"
        >
          {{ familyCopy.cancel }}
        </RouterLink>
      </div>
    </form>

    <div v-else-if="screen === 'family-management' && membership" class="family-page">
      <div class="family-page__heading">
        <div>
          <p class="meta-label text-sm">{{ copy.ready }}</p>
          <h2 class="page-heading text-2xl">{{ familyCopy.heading }}</h2>
          <p class="body-muted mt-1 text-sm">{{ membership.household.name }}</p>
        </div>
        <div class="family-page__actions">
          <RouterLink :to="{ name: AppRouteName.newChild }" class="primary family-page__create">
            {{ familyCopy.createChild }}
          </RouterLink>
          <RouterLink :to="{ name: AppRouteName.newParent }" class="secondary">{{
            messages.parentAccounts.createHeading
          }}</RouterLink>
          <button type="button" class="link family-page__sign-out" @click="signOut()">
            {{ copy.signOut }}
          </button>
        </div>
      </div>
      <p v-if="familyMembers.length === 0" class="body-secondary">{{ familyCopy.empty }}</p>
      <ul v-else class="family-directory" :aria-label="familyCopy.memberDirectory">
        <li v-for="member in familyMembers" :key="member.memberId" class="family-member">
          <span
            v-if="member.color"
            class="profile-color-swatch"
            :style="{ backgroundColor: ProfileColorHex[member.color] }"
            aria-hidden="true"
          />
          <div class="family-member__identity">
            <p class="body-strong font-medium">{{ member.displayName ?? member.username }}</p>
            <dl class="family-member__metadata body-secondary text-sm">
              <div>
                <dt class="sr-only">{{ familyCopy.username }}</dt>
                <dd>@{{ member.username }}</dd>
              </div>
              <div v-if="member.role === 'parent'" class="family-role-token">
                <dt class="sr-only">{{ familyCopy.role }}</dt>
                <dd>{{ familyCopy.parent }}</dd>
              </div>
              <div
                v-if="
                  member.role === 'parent' &&
                  member.activationState === 'ACTIVE' &&
                  !member.displayName
                "
              >
                <dt class="sr-only">{{ familyCopy.status }}</dt>
                <dd>{{ messages.parentAccounts.profilePending }}</dd>
              </div>
              <div v-if="member.activationState === 'PENDING_ACTIVATION'">
                <dt class="sr-only">{{ familyCopy.status }}</dt>
                <dd>{{ familyCopy.pending }}</dd>
              </div>
            </dl>
          </div>
          <RouterLink
            v-if="member.memberId === membership.memberId"
            :to="{ name: AppRouteName.profile }"
            class="link family-member__action"
            @click="prepareProfileEdit"
          >
            {{ familyCopy.editProfile }}
          </RouterLink>
          <div
            v-if="member.role === 'child' && member.activationState === 'ACTIVE'"
            class="family-member__actions"
          >
            <RouterLink
              :to="{ name: AppRouteName.resetChildPassword, params: { memberId: member.memberId } }"
              class="link"
            >
              {{ familyCopy.resetChildPassword }}
            </RouterLink>
            <ChildRemovalControl
              :member="member"
              @changed="run(async () => loadFamilyManagement(session.requestContext()))"
            />
          </div>
          <PendingParentControls
            v-if="member.activationState === 'PENDING_ACTIVATION'"
            :member="member"
            @changed="run(async () => loadFamilyManagement(session.requestContext()))"
          />
        </li>
      </ul>
    </div>
  </section>
</template>
