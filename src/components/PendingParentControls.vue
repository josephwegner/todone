<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import type { FamilyMember } from '../services/familyClient';
import { messages } from '../i18n/messages';
import { useSessionController } from '../session/injection';
import { mutatePendingParent } from '../services/parentAccountClient';
const props = defineProps<{ member: FamilyMember }>(),
  emit = defineEmits<{ changed: [] }>(),
  session = useSessionController(),
  copy = messages.parentAccounts;
const dialog = ref<globalThis.HTMLDialogElement | null>(null),
  email = ref(''),
  status = ref(''),
  notice = ref(''),
  action = ref<'resend' | 'email' | 'cancel'>('resend'),
  busy = ref(false),
  blocked = ref(false);
let key = globalThis.crypto.randomUUID();
function close() {
  dialog.value?.close();
  email.value = '';
}
onBeforeUnmount(close);
onDeactivated(close);
watch(() => props.member.memberId, close);
async function open(next: typeof action.value) {
  if (busy.value || blocked.value) return;
  action.value = next;
  email.value = '';
  status.value = '';
  notice.value = '';
  key = globalThis.crypto.randomUUID();
  dialog.value?.showModal();
  await nextTick();
  dialog.value?.querySelector<globalThis.HTMLElement>('input,button')?.focus();
}
async function submit() {
  if (busy.value || blocked.value) return;
  busy.value = true;
  const request = session.requestContext();
  try {
    const result = await mutatePendingParent(
      request,
      props.member.memberId,
      action.value,
      key,
      email.value,
    );
    email.value = '';
    if (!request.isCurrent?.()) return;
    if (result.kind === 'error') {
      status.value = result.message;
      blocked.value = !result.recoverable;
      if (result.conflict) {
        close();
        notice.value = result.message;
        emit('changed');
      }
      return;
    }
    close();
    notice.value = copy.actionSuccess;
    emit('changed');
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="flex flex-wrap gap-3">
    <button
      v-if="member.allowedActions.includes('RESEND_WELCOME')"
      type="button"
      class="link"
      :disabled="busy || blocked"
      @click="open('resend')"
    >
      {{ copy.resend }}
    </button>
    <button
      v-if="member.allowedActions.includes('CHANGE_EMAIL_AND_RESEND')"
      type="button"
      class="link"
      :disabled="busy || blocked"
      @click="open('email')"
    >
      {{ copy.changeEmail }}
    </button>
    <button
      v-if="member.allowedActions.includes('CANCEL_PENDING_ACCOUNT')"
      type="button"
      class="link"
      :disabled="busy || blocked"
      @click="open('cancel')"
    >
      {{ copy.cancelAccount }}
    </button>
    <p v-if="notice" role="status">{{ notice }}</p>
    <dialog
      ref="dialog"
      :aria-busy="busy"
      class="max-w-lg rounded-lg p-6"
      :aria-label="
        action === 'email'
          ? copy.changeEmail
          : action === 'cancel'
            ? copy.cancelAccount
            : copy.resend
      "
      @cancel="busy && $event.preventDefault()"
      @close="email = ''"
    >
      <form class="space-y-5" @submit.prevent="submit">
        <h2 class="text-xl font-semibold">{{ member.displayName ?? member.username }}</h2>
        <p v-if="action === 'cancel'">{{ copy.cancelConfirmation }}</p>
        <label v-if="action === 'email'" class="block"
          >{{ copy.email
          }}<input
            v-model="email"
            type="email"
            required
            autocomplete="off"
            :disabled="busy || blocked"
            class="field"
        /></label>
        <p v-if="status" role="alert" class="error">{{ status }}</p>
        <div class="form-actions">
          <button type="submit" class="primary" :disabled="busy || blocked">
            {{ copy.confirm }}</button
          ><button type="button" class="secondary" :disabled="busy" @click="close">
            {{ messages.familyManagement.cancel }}
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>
