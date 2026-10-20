<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import App from '../App.vue';
import { useSessionController } from '../session/injection';
import { sessionRouteDestination } from '../router';
import { isPublicRouteName, type AppRouteName } from '../router/routes';
import { applyMembershipContext } from '../presentation/appContext';
import { applyProfileTone, clearProfileTone } from '../presentation/profileTone';
import { messages } from '../i18n/messages';

const session = useSessionController();
const route = useRoute();
const router = useRouter();
const retrying = ref(false);
const heading = ref<globalThis.HTMLElement | null>(null);
const copy = messages.session;
const showApplication = computed(
  () =>
    session.state.value.kind === 'ready' ||
    (session.state.value.kind === 'signed-out' &&
      route.name &&
      isPublicRouteName(route.name as AppRouteName)),
);
const lastFailure = ref('');
const currentFailure = computed(() =>
  session.state.value.kind === 'recoverable-error'
    ? session.state.value.failure
    : lastFailure.value,
);
const failureMessage = computed(() => {
  const failure = currentFailure.value;
  if (failure === 'pending-activation') return messages.membershipApi.pendingActivation;
  if (failure === 'inactive') return messages.membershipApi.inactive;
  if (failure === 'credentials-stale' || failure === 'session-ended')
    return messages.bootstrap.sessionEnded;
  if (failure === 'storage-unavailable') return copy.storageHelp;
  return copy.startupHelp;
});
watch(
  session.state,
  async (state) => {
    if (state.kind === 'ready' && state.context.kind !== 'unattached')
      applyMembershipContext(state.context.membership);
    else applyMembershipContext(null);
    if (state.kind === 'ready' && state.context.kind === 'active')
      applyProfileTone(state.context.profile.color);
    else clearProfileTone();
    if (route.name && (state.kind === 'ready' || state.kind === 'signed-out')) {
      const destination = sessionRouteDestination(route.name as AppRouteName, state);
      if (destination !== true) await router.replace({ name: destination });
    }
    if (state.kind === 'recoverable-error') {
      lastFailure.value = state.failure;
      await nextTick();
      heading.value?.focus();
    }
  },
  { immediate: true },
);
async function retry() {
  if (retrying.value) return;
  retrying.value = true;
  try {
    await session.initialize();
  } finally {
    retrying.value = false;
  }
}
const backgroundRetrying = ref(false);
async function retryBackground() {
  if (backgroundRetrying.value) return;
  backgroundRetrying.value = true;
  try {
    if (
      session.backgroundFailure.value === 'provider-unavailable' ||
      session.backgroundFailure.value === 'storage-unavailable'
    )
      await session.ensureUsableCredentials(true);
    await session.refreshContext(true);
  } catch {
    /* Controller retains safe persistent guidance. */
  } finally {
    backgroundRetrying.value = false;
  }
}
function isDocumentHidden() {
  return globalThis.document.visibilityState === 'hidden';
}
const presentationReady = ref(!isDocumentHidden());
let presentationCheck = 0;
function hidePrivatePresentation() {
  presentationCheck += 1;
  presentationReady.value = false;
}
async function reconcileForeground() {
  if (isDocumentHidden()) {
    hidePrivatePresentation();
    return;
  }
  const check = ++presentationCheck;
  const identity = session.identityVersion.value;
  const previousFocus = globalThis.document.activeElement;
  presentationReady.value = false;
  try {
    await session.reconcileBrowserAccount();
  } finally {
    if (check === presentationCheck && !isDocumentHidden()) {
      presentationReady.value = true;
      if (
        session.state.value.kind === 'ready' &&
        identity === session.identityVersion.value &&
        previousFocus instanceof globalThis.HTMLElement &&
        previousFocus.isConnected &&
        globalThis.document.activeElement === globalThis.document.body
      )
        previousFocus.focus({ preventScroll: true });
    }
  }
  void session.reconcile().catch(() => {
    /* Background renewal/context failure preserves permitted content. */
  });
}
onMounted(() => {
  globalThis.document.addEventListener('visibilitychange', reconcileForeground);
  globalThis.window.addEventListener('pageshow', reconcileForeground);
  globalThis.window.addEventListener('pagehide', hidePrivatePresentation);
  globalThis.window.addEventListener('focus', reconcileForeground);
});
onBeforeUnmount(() => {
  presentationCheck += 1;
  globalThis.document.removeEventListener('visibilitychange', reconcileForeground);
  globalThis.window.removeEventListener('pageshow', reconcileForeground);
  globalThis.window.removeEventListener('pagehide', hidePrivatePresentation);
  globalThis.window.removeEventListener('focus', reconcileForeground);
  session.dispose();
});
</script>
<template>
  <div
    v-if="showApplication"
    :style="{ visibility: presentationReady ? 'visible' : 'hidden' }"
    :inert="!presentationReady"
  >
    <App :key="session.identityVersion.value" />
    <aside
      v-if="session.backgroundFailure.value"
      class="mx-auto max-w-5xl border-l-4 border-danger px-5 py-4"
      :aria-label="copy.backgroundHeading"
    >
      <h2 class="font-semibold">{{ copy.backgroundHeading }}</h2>
      <p role="status">{{ copy.backgroundHelp }}</p>
      <button
        type="button"
        class="secondary mt-3"
        :disabled="backgroundRetrying"
        @click="retryBackground"
      >
        {{ backgroundRetrying ? copy.retrying : copy.retry }}
      </button>
    </aside>
  </div>
  <div v-else>
    <header class="bg-action-deep px-5 py-4 text-xl font-semibold text-profile-on">
      {{ messages.navigation.appName }}
    </header>
    <main id="main-content" class="mx-auto max-w-xl px-5 py-8">
      <template v-if="session.state.value.kind === 'recoverable-error' || retrying">
        <h1
          ref="heading"
          tabindex="-1"
          aria-describedby="session-failure-message"
          class="page-heading text-2xl"
        >
          {{ currentFailure === 'storage-unavailable' ? copy.storageHeading : copy.startupHeading }}
        </h1>
        <p id="session-failure-message" class="mt-6 border-l-4 border-danger pl-4">
          {{ failureMessage }}
        </p>
        <div class="form-actions mt-6">
          <button type="button" class="primary" :disabled="retrying" @click="retry">
            {{ retrying ? copy.retrying : copy.retry }}
          </button>
          <button type="button" class="secondary" @click="session.signOut">
            {{ messages.bootstrap.signOut }}
          </button>
        </div>
      </template>
      <template v-else>
        <h1 class="page-heading text-2xl">{{ messages.bootstrap.restoreHeading }}</h1>
        <div class="min-h-40 mt-4" role="status">{{ messages.bootstrap.restoring }}</div>
      </template>
    </main>
  </div>
</template>
