<script setup lang="ts">
import { Capability, hasCapability } from '../../shared/authorizationCapabilities';
import { onBeforeUnmount, onDeactivated, ref } from 'vue';
import type { FamilyMember } from '../services/familyClient';
import { messages } from '../i18n/messages';
import { useSessionController } from '../session/injection';
import { removeChild } from '../services/parentAccountClient';
const props = defineProps<{ member: FamilyMember }>(),
  emit = defineEmits<{ changed: [] }>(),
  session = useSessionController(),
  copy = messages.parentAccounts;
const dialog = ref<globalThis.HTMLDialogElement | null>(null),
  busy = ref(false),
  blocked = ref(false),
  status = ref('');
let key = globalThis.crypto.randomUUID();
function close() {
  dialog.value?.close();
}
onBeforeUnmount(close);
onDeactivated(close);
function open() {
  if (blocked.value) return;
  status.value = '';
  key = globalThis.crypto.randomUUID();
  dialog.value?.showModal();
}
async function confirm() {
  if (busy.value || blocked.value) return;
  busy.value = true;
  const request = session.requestContext();
  try {
    const result = await removeChild(request, props.member.memberId, key);
    if (!request.isCurrent?.()) return;
    if (result.kind === 'error') {
      status.value = result.message;
      blocked.value = !result.recoverable;
      if (result.conflict) {
        close();
        emit('changed');
      }
      return;
    }
    close();
    emit('changed');
  } catch {
    status.value = copy.uncertain;
    blocked.value = true;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div>
    <button
      v-if="hasCapability(member.allowedActions, Capability.childRemove)"
      type="button"
      class="link"
      :disabled="busy || blocked"
      @click="open"
    >
      {{ copy.removeChild }}
    </button>
    <dialog
      ref="dialog"
      :aria-label="copy.removeChild"
      :aria-busy="busy"
      class="max-w-lg rounded-lg p-6"
      @cancel="busy && $event.preventDefault()"
    >
      <form class="space-y-5" @submit.prevent="confirm">
        <h2 class="text-xl font-semibold">{{ member.displayName ?? member.username }}</h2>
        <p>{{ copy.removeHelp }}</p>
        <p v-if="status" role="alert" class="error">{{ status }}</p>
        <div class="form-actions">
          <button type="button" class="secondary" :disabled="busy" autofocus @click="close">
            {{ messages.familyManagement.cancel }}</button
          ><button type="submit" class="primary" :disabled="busy || blocked">
            {{ copy.confirm }}
          </button>
        </div>
      </form>
    </dialog>
  </div>
</template>
