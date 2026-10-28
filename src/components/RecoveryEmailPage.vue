<script setup lang="ts">
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { messages } from '../i18n/messages';
import { AppRouteName } from '../router/routes';
import { useSessionController } from '../session/injection';
import { readRecoveryEmail, replaceRecoveryEmail } from '../services/parentAccountClient';
const session = useSessionController(),
  copy = messages.parentAccounts,
  heading = ref<globalThis.HTMLElement | null>(null),
  email = ref(''),
  currentEmail = ref(''),
  code = ref(''),
  busy = ref(false),
  verifying = ref(false),
  blocked = ref(false),
  status = ref(''),
  error = ref(false);
let active = true;
function clear() {
  active = false;
  email.value = '';
  currentEmail.value = '';
  code.value = '';
  verifying.value = false;
  status.value = '';
}
onBeforeUnmount(clear);
onDeactivated(clear);
onActivated(() => {
  active = true;
  void load();
  void nextTick(() => heading.value?.focus());
});
async function load() {
  busy.value = true;
  try {
    status.value = '';
    error.value = false;
    await session.ensureUsableCredentials(true);
    if (!active) return;
    const request = session.requestContext();
    const result = await readRecoveryEmail(request);
    if (!active || !request.isCurrent?.()) return;
    if (result.kind === 'success') currentEmail.value = result.email;
    else {
      status.value = result.message;
      error.value = true;
    }
  } catch {
    if (active) {
      status.value = messages.generic.networkError;
      error.value = true;
    }
  } finally {
    busy.value = false;
  }
}
async function submit() {
  if (busy.value || blocked.value) return;
  busy.value = true;
  status.value = '';
  error.value = false;
  const request = session.requestContext();
  try {
    if (verifying.value) {
      const submittedCode = code.value;
      code.value = '';
      const result = await session.verifyEmailAttribute(submittedCode);
      if (!active || !request.isCurrent?.() || result.kind === 'cancelled') return;
      if (result.kind === 'error') {
        status.value = result.message;
        error.value = true;
        return;
      }
      verifying.value = false;
      const current = await readRecoveryEmail(request);
      if (!active || !request.isCurrent?.()) return;
      if (current.kind === 'success') {
        currentEmail.value = current.email;
        status.value = copy.emailUpdated;
      } else {
        status.value = current.message;
        error.value = true;
      }
    } else {
      const result = await replaceRecoveryEmail(request, email.value);
      email.value = '';
      if (!active || !request.isCurrent?.()) return;
      if (result.kind === 'error') {
        status.value = result.message;
        error.value = true;
        blocked.value = !result.recoverable;
        return;
      }
      verifying.value = true;
      status.value = copy.sentCode;
    }
  } catch {
    if (active) {
      status.value = copy.uncertain;
      error.value = true;
      blocked.value = true;
    }
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section class="mx-auto max-w-xl space-y-6">
    <h1 ref="heading" tabindex="-1" class="page-heading text-2xl">{{ copy.securityHeading }}</h1>
    <p class="body-secondary">{{ copy.securityHelp }}</p>
    <p class="min-h-6 break-words">{{ currentEmail }}</p>
    <p v-if="status" :role="error ? 'alert' : 'status'" :class="error ? 'error' : 'body-secondary'">
      {{ status }}
    </p>
    <form class="space-y-5" @submit.prevent="submit">
      <label v-if="verifying" class="block"
        >{{ copy.verifyCode
        }}<input
          v-model="code"
          class="field"
          required
          autocomplete="one-time-code"
          :disabled="busy || blocked"
      /></label>
      <label v-else class="block"
        >{{ copy.email
        }}<input
          v-model="email"
          class="field"
          required
          type="email"
          autocomplete="off"
          :disabled="busy || blocked"
      /></label>
      <div class="form-actions">
        <button class="primary" type="submit" :disabled="busy || blocked">
          {{ verifying ? copy.verifyReplacement : copy.replaceEmail }}</button
        ><RouterLink :to="{ name: AppRouteName.profile }" class="secondary">{{
          messages.familyManagement.cancel
        }}</RouterLink>
      </div>
    </form>
    <button v-if="error && !blocked" type="button" class="link" :disabled="busy" @click="load">
      {{ messages.familyManagement.retry }}
    </button>
  </section>
</template>
