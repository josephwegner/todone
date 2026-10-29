import {
  Capability,
  hasCapability,
  type CapabilityKey,
} from '../../shared/authorizationCapabilities';
import { createRouter, createWebHistory, type RouterHistory } from 'vue-router';
import RecoveryEmailPage from '../components/RecoveryEmailPage.vue';
import ParentAccountPage from '../components/ParentAccountPage.vue';
import ProductionBootstrap from '../components/ProductionBootstrap.vue';
import TodoPlaceholder from '../components/TodoPlaceholder.vue';
import { messages } from '../i18n/messages';
import type { SessionController, SessionState } from '../session/sessionController';
import {
  appRouteDefinitions,
  AppRouteName,
  isPublicRouteName,
  isUnavailableRouteName,
} from './routes';
import type { AppRouteName as RouteName } from './routes';

/** Presentation routing only; every API still enforces current server authorization. */
export function sessionRouteDestination(
  routeName: RouteName,
  state: SessionState,
): true | RouteName {
  if (isUnavailableRouteName(routeName)) return AppRouteName.root;
  if (state.kind === 'signed-out') {
    if (isPublicRouteName(routeName)) return true;
    return AppRouteName.signIn;
  }
  if (state.kind === 'recoverable-error' && state.failure === 'pending-activation') {
    if (routeName === AppRouteName.activateParent) return true;
    return AppRouteName.activateParent;
  }
  if (state.kind !== 'ready') return true;
  const context = state.context;
  if (context.kind === 'unattached') {
    if (routeName === AppRouteName.householdSetup) return true;
    return AppRouteName.householdSetup;
  }
  if (context.kind === 'profile-required') {
    if (routeName === AppRouteName.profileSetup) return true;
    return AppRouteName.profileSetup;
  }
  const capabilities = context.membership.capabilities;
  let home: RouteName = AppRouteName.todos;
  if (hasCapability(capabilities, Capability.childManage)) home = AppRouteName.family;
  const required: Partial<Record<RouteName, CapabilityKey>> = {
    [AppRouteName.family]: Capability.childManage,
    [AppRouteName.newChild]: Capability.childCreate,
    [AppRouteName.newParent]: Capability.parentCreate,
    [AppRouteName.security]: Capability.recoveryEmailSelfManage,
    [AppRouteName.resetChildPassword]: Capability.childManage,
    [AppRouteName.profile]: Capability.profileSelfRead,
  };
  const key = required[routeName];
  if (
    routeName === AppRouteName.root ||
    isPublicRouteName(routeName) ||
    routeName === AppRouteName.householdSetup ||
    routeName === AppRouteName.profileSetup
  )
    return home;
  if (key && !hasCapability(capabilities, key)) return home;
  return true;
}

export function createAppRouter(
  session: SessionController,
  history: RouterHistory = createWebHistory(),
) {
  const router = createRouter({
    history,
    routes: [
      ...Object.values(appRouteDefinitions).map((route) => ({
        path: route.path,
        name: route.name,
        component:
          route.name === AppRouteName.security
            ? RecoveryEmailPage
            : route.name === AppRouteName.activateParent || route.name === AppRouteName.newParent
              ? ParentAccountPage
              : route.todoPlaceholder
                ? TodoPlaceholder
                : ProductionBootstrap,
      })),
      { path: '/:pathMatch(.*)*', redirect: { name: AppRouteName.root } },
    ],
  });
  router.beforeEach(async (to) => {
    if (session.state.value.kind !== 'uninitialized' && session.state.value.kind !== 'initializing')
      await session.reconcileBrowserAccount();
    if (session.state.value.kind === 'uninitialized' || session.state.value.kind === 'initializing')
      await session.initialize();
    const destination = sessionRouteDestination(to.name as RouteName, session.state.value);
    if (destination === true) return true;
    return { name: destination, replace: true };
  });
  router.afterEach((to) => {
    document.title = `${appRouteDefinitions[to.name as RouteName].title} · ${messages.navigation.appName}`;
  });
  return router;
}
