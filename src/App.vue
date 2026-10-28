<script setup lang="ts">
import { ListTodo, Trees, UserRound, UsersRound } from '@lucide/vue';
import { computed } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { activeMembershipRole } from './presentation/appContext';
import { messages } from './i18n/messages';
import { AppRouteName } from './router/routes';

const route = useRoute();
const inFamilySection = computed(() =>
  [
    AppRouteName.family,
    AppRouteName.newChild,
    AppRouteName.resetChildPassword,
    AppRouteName.newParent,
  ].some((name) => name === route?.name),
);
const hasApplicationNavigation = computed(() => activeMembershipRole.value !== null);
</script>

<template>
  <a href="#main-content" class="skip-link">Skip to main content</a>
  <header class="border-b border-action-deep/15 bg-action-deep text-profile-on">
    <div
      class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8"
    >
      <h1 class="flex items-center gap-2 text-xl font-semibold tracking-tight">
        <Trees :size="22" stroke-width="1.75" aria-hidden="true" />
        Todone
      </h1>
      <nav
        v-if="hasApplicationNavigation"
        class="flex flex-wrap items-center gap-1 text-sm"
        aria-label="Application"
      >
        <RouterLink
          v-if="activeMembershipRole === 'child'"
          :to="{ name: AppRouteName.todos }"
          class="app-navigation-link"
        >
          <ListTodo :size="18" aria-hidden="true" />
          My Todos
        </RouterLink>
        <RouterLink
          v-if="activeMembershipRole === 'parent'"
          :to="{ name: AppRouteName.family }"
          class="app-navigation-link"
          :class="{ 'router-link-exact-active': inFamilySection }"
          :aria-current="inFamilySection ? 'page' : undefined"
        >
          <UsersRound :size="18" aria-hidden="true" />
          Family
        </RouterLink>
        <RouterLink :to="{ name: AppRouteName.profile }" class="app-navigation-link">
          <UserRound :size="18" aria-hidden="true" />
          My profile
        </RouterLink>
        <RouterLink
          v-if="activeMembershipRole === 'parent'"
          :to="{ name: AppRouteName.security }"
          class="app-navigation-link"
          >{{ messages.navigation.securityTitle }}</RouterLink
        >
      </nav>
    </div>
  </header>

  <main id="main-content" class="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
    <RouterView v-slot="{ Component }">
      <KeepAlive>
        <component :is="Component" />
      </KeepAlive>
    </RouterView>
  </main>
</template>
