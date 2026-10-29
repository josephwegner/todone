<script setup lang="ts">
import { Capability, hasCapability } from '../../shared/authorizationCapabilities';
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { ParentAccountError } from '../../shared/familyAccountContract';
import { useSessionController } from '../session/injection';
import { messages } from '../i18n/messages';
import { AppRouteName } from '../router/routes';
import {
  createParent,
  activateParent,
  type ParentAccountResult,
} from '../services/parentAccountClient';
import { meetsAccountPasswordPolicy } from '../services/accountPassword';
import { normalizeUsernameForCognito } from '../services/username';
const session = useSessionController(),
  route = useRoute(),
  router = useRouter(),
  copy = messages.parentAccounts;
const heading = ref<globalThis.HTMLElement | null>(null),
  username = ref(''),
  email = ref(''),
  setupCode = ref(''),
  password = ref(''),
  verificationCode = ref(''),
  busy = ref(false),
  status = ref(''),
  isError = ref(false),
  fields = ref<Record<string, string>>({});
const blockedUsername = ref('');
const activationStep = ref<'checking' | 'verification' | 'activation'>('checking');
let idempotencyKey = globalThis.crypto.randomUUID();
let active = true;
const creating = computed(() => route.name === AppRouteName.newParent);
const pending = computed(
  () =>
    session.state.value.kind === 'recoverable-error' &&
    session.state.value.failure === 'pending-activation',
);
const title = computed(() =>
  creating.value ? copy.createHeading : pending.value ? copy.verifyHeading : copy.activationHeading,
);
watch([username, email], () => {
  idempotencyKey = globalThis.crypto.randomUUID();
  fields.value = {};
});
function clear() {
  username.value = '';
  email.value = '';
  setupCode.value = '';
  password.value = '';
  verificationCode.value = '';
  status.value = '';
  fields.value = {};
  activationStep.value = 'checking';
}
watch(session.identityVersion, () => {
  clear();
  blockedUsername.value = '';
});
async function signOut() {
  clear();
  await session.signOut();
  await router.replace({ name: AppRouteName.signIn });
}
onBeforeUnmount(() => {
  active = false;
  clear();
});
onDeactivated(() => {
  active = false;
  clear();
});
onMounted(() => {
  void nextTick(() => heading.value?.focus());
});
onActivated(() => {
  active = true;
  if (pending.value && !busy.value && activationStep.value === 'checking') void resumeActivation();
  void nextTick(() => heading.value?.focus());
});
watch(
  () => route.name,
  () => {
    clear();
    void nextTick(() => heading.value?.focus());
  },
);
async function run(work: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  status.value = '';
  isError.value = false;
  fields.value = {};
  try {
    await work();
  } catch {
    if (active) {
      status.value = copy.uncertain;
      isError.value = true;
    }
  } finally {
    busy.value = false;
    setupCode.value = '';
    password.value = '';
    verificationCode.value = '';
  }
}
function outcome(result: ParentAccountResult) {
  if (result.kind === 'error') {
    status.value = result.message;
    isError.value = true;
    fields.value = Object.fromEntries((result.fieldErrors ?? []).map((f) => [f.field, f.message]));
    return false;
  }
  return true;
}
const canCreate = computed(() => {
  const state = session.state.value;
  return (
    state.kind === 'ready' &&
    state.context.kind !== 'unattached' &&
    hasCapability(state.context.membership.capabilities, Capability.parentCreate)
  );
});
async function provision() {
  if (!canCreate.value) return;
  await run(async () => {
    const request = session.requestContext();
    const result = await createParent(
      request,
      {
        username: normalizeUsernameForCognito(username.value),
        email: email.value,
      },
      idempotencyKey,
    );
    if (!active || !request.isCurrent?.()) return;
    if (!outcome(result)) {
      await nextTick();
      heading.value?.parentElement
        ?.querySelector<globalThis.HTMLElement>('[aria-invalid="true"]')
        ?.focus();
      if (result.kind === 'error' && !result.recoverable)
        blockedUsername.value = normalizeUsernameForCognito(username.value);
      return;
    }
    clear();
    await router.push({ name: AppRouteName.family });
  });
}
async function setup() {
  await run(async () => {
    if (!meetsAccountPasswordPolicy(password.value)) {
      status.value = messages.bootstrap.passwordPolicyError;
      isError.value = true;
      return;
    }
    const submittedCode = setupCode.value,
      submittedPassword = password.value;
    setupCode.value = '';
    password.value = '';
    const result = await session.signIn(username.value, submittedCode, submittedPassword);
    if (result.kind === 'error' && active) {
      status.value = result.message;
      isError.value = true;
    }
  });
}
// A restored pending session may already have consumed its verification code.
watch(
  [pending, busy],
  () => {
    if (active && pending.value && !busy.value && activationStep.value === 'checking')
      void resumeActivation();
  },
  { immediate: true },
);
async function finishActivation(request: ReturnType<typeof session.requestContext>) {
  activationStep.value = 'activation';
  await session.ensureUsableCredentials(true);
  if (!active || !request.isCurrent?.()) return;
  const activated = await activateParent(request);
  if (!active || !request.isCurrent?.()) return;
  if (!outcome(activated)) {
    if (activated.kind === 'error' && activated.code === ParentAccountError.unproven)
      activationStep.value = 'verification';
    else if (activated.kind === 'error' && activated.conflict) {
      await session.refreshContext(true);
      if (!active || !request.isCurrent?.()) return;
    }
    return;
  }
  await session.refreshContext(true);
}
async function resumeActivation() {
  await run(() => finishActivation(session.requestContext(false)));
}
async function verify(sendOnly = false) {
  await run(async () => {
    const request = session.requestContext(false);
    // Native verification may consume the code even if the subsequent renewal fails.
    if (!sendOnly) activationStep.value = 'activation';
    const result = await session.verifyEmailAttribute(
      sendOnly ? undefined : verificationCode.value,
    );
    if (!active || !request.isCurrent?.() || result.kind === 'cancelled') return;
    if (result.kind === 'error') {
      if (!sendOnly) activationStep.value = 'verification';
      status.value = result.message;
      isError.value = true;
      return;
    }
    if (sendOnly) {
      status.value = copy.sentCode;
      return;
    }
    await finishActivation(request);
  });
}
</script>
<template>
  <section class="mx-auto max-w-xl space-y-6">
    <h1 ref="heading" tabindex="-1" class="page-heading text-2xl">{{ title }}</h1>
    <p v-if="creating" class="body-secondary">{{ copy.createHelp }}</p>
    <p v-else-if="pending" class="body-secondary">{{ copy.verifyHelp }}</p>
    <div class="min-h-12" aria-live="polite">
      <p
        v-if="status"
        :role="isError ? 'alert' : 'status'"
        :class="isError ? 'error' : 'body-secondary'"
      >
        {{ status }}
      </p>
    </div>
    <form v-if="creating" class="space-y-5" @submit.prevent="provision">
      <label class="block"
        >{{ messages.familyManagement.username
        }}<input
          v-model="username"
          class="field"
          required
          minlength="3"
          maxlength="24"
          autocomplete="off"
          :disabled="busy"
          :aria-invalid="!!fields.username"
          aria-describedby="parent-username-error"
      /></label>
      <p v-if="fields.username" id="parent-username-error" class="error">{{ fields.username }}</p>
      <label class="block"
        >{{ copy.email
        }}<input
          v-model="email"
          class="field"
          required
          type="email"
          maxlength="254"
          autocomplete="off"
          :disabled="busy"
          :aria-invalid="!!fields.email"
          aria-describedby="parent-email-error"
      /></label>
      <p v-if="fields.email" id="parent-email-error" class="error">{{ fields.email }}</p>
      <div class="form-actions">
        <button
          class="primary"
          type="submit"
          :disabled="
            busy ||
            !canCreate ||
            (!!blockedUsername && blockedUsername === normalizeUsernameForCognito(username))
          "
        >
          {{ busy ? copy.creating : copy.createAction }}</button
        ><RouterLink :to="{ name: AppRouteName.family }" class="secondary">{{
          messages.familyManagement.cancel
        }}</RouterLink>
      </div>
    </form>
    <form
      v-else-if="pending"
      class="space-y-5"
      @submit.prevent="activationStep === 'verification' ? verify() : resumeActivation()"
    >
      <p v-if="activationStep !== 'verification'" class="body-secondary">
        {{ copy.activationRetryHelp }}
      </p>
      <label v-if="activationStep === 'verification'" class="block"
        >{{ copy.verifyCode
        }}<input
          v-model="verificationCode"
          class="field"
          required
          autocomplete="one-time-code"
          :disabled="busy"
      /></label>
      <div class="form-actions">
        <button type="submit" class="primary" :disabled="busy">
          {{ activationStep === 'verification' ? copy.verifyAction : copy.retryActivation }}</button
        ><button
          v-if="activationStep === 'verification'"
          type="button"
          class="secondary"
          :disabled="busy"
          @click="verify(true)"
        >
          {{ copy.sendCode }}
        </button>
      </div>
      <button type="button" class="link" @click="signOut">
        {{ messages.bootstrap.signOut }}
      </button>
    </form>
    <form v-else class="space-y-5" @submit.prevent="setup">
      <label class="block"
        >{{ messages.familyManagement.username
        }}<input v-model="username" class="field" required autocomplete="username" :disabled="busy"
      /></label>
      <label class="block"
        >{{ copy.setupCode
        }}<input
          v-model="setupCode"
          class="field"
          required
          type="password"
          autocomplete="off"
          :disabled="busy"
      /></label>
      <label class="block"
        >{{ messages.bootstrap.password
        }}<input
          v-model="password"
          class="field"
          required
          type="password"
          autocomplete="new-password"
          :disabled="busy"
          aria-describedby="parent-password-policy"
      /></label>
      <p id="parent-password-policy" class="body-muted text-sm">
        {{ messages.bootstrap.passwordPolicy }}
      </p>
      <div class="form-actions">
        <button type="submit" class="primary" :disabled="busy">{{ copy.setupAction }}</button
        ><RouterLink :to="{ name: AppRouteName.signIn }" class="secondary">{{
          messages.familyManagement.cancel
        }}</RouterLink>
      </div>
    </form>
  </section>
</template>
