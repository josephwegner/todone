import { messages } from '../i18n/messages';

export const AppRouteName = {
  root: 'root',
  signIn: 'sign-in',
  register: 'register',
  verifyEmail: 'verify-email',
  forgotPassword: 'forgot-password',
  resetPassword: 'reset-password',
  activateParent: 'activate-parent',
  todos: 'todos',
  householdSetup: 'household-setup',
  profileSetup: 'profile-setup',
  family: 'family',
  profile: 'profile',
  security: 'security',
  newChild: 'new-child',
  resetChildPassword: 'reset-child-password',
  newParent: 'new-parent',
} as const;

export type AppRouteName = (typeof AppRouteName)[keyof typeof AppRouteName];

export type BootstrapPageScreen =
  | 'signin'
  | 'register'
  | 'confirm'
  | 'forgot'
  | 'reset'
  | 'household'
  | 'profile-setup'
  | 'family-management'
  | 'profile-edit'
  | 'child-create'
  | 'child-password-reset';

type AppRouteDefinition = {
  name: AppRouteName;
  path: string;
  title: string;
  bootstrapScreen: BootstrapPageScreen | null;
  public?: true;
  unavailable?: true;
  todoPlaceholder?: true;
};

/**
 * Canonical route metadata. Add every route here so path, access, title, and
 * bootstrap-surface behavior stay synchronized as route coverage grows.
 */
export const appRouteDefinitions: Record<AppRouteName, AppRouteDefinition> = {
  [AppRouteName.root]: {
    name: AppRouteName.root,
    path: '/',
    title: messages.navigation.homeTitle,
    bootstrapScreen: null,
  },
  [AppRouteName.signIn]: {
    name: AppRouteName.signIn,
    path: '/sign-in',
    title: messages.navigation.signInTitle,
    bootstrapScreen: 'signin',
    public: true,
  },
  [AppRouteName.register]: {
    name: AppRouteName.register,
    path: '/register',
    title: messages.navigation.registerTitle,
    bootstrapScreen: 'register',
    public: true,
  },
  [AppRouteName.verifyEmail]: {
    name: AppRouteName.verifyEmail,
    path: '/verify-email',
    title: messages.navigation.verifyEmailTitle,
    bootstrapScreen: 'confirm',
    public: true,
  },
  [AppRouteName.forgotPassword]: {
    name: AppRouteName.forgotPassword,
    path: '/forgot-password',
    title: messages.navigation.forgotPasswordTitle,
    bootstrapScreen: 'forgot',
    public: true,
  },
  [AppRouteName.resetPassword]: {
    name: AppRouteName.resetPassword,
    path: '/reset-password',
    title: messages.navigation.resetPasswordTitle,
    bootstrapScreen: 'reset',
    public: true,
  },
  [AppRouteName.activateParent]: {
    name: AppRouteName.activateParent,
    path: '/activate-parent',
    title: messages.navigation.activateParentTitle,
    bootstrapScreen: 'signin',
    public: true,
  },
  [AppRouteName.todos]: {
    name: AppRouteName.todos,
    path: '/todos',
    title: messages.navigation.todosTitle,
    bootstrapScreen: null,
    todoPlaceholder: true,
  },
  [AppRouteName.householdSetup]: {
    name: AppRouteName.householdSetup,
    path: '/household/setup',
    title: messages.navigation.householdSetupTitle,
    bootstrapScreen: 'household',
  },
  [AppRouteName.profileSetup]: {
    name: AppRouteName.profileSetup,
    path: '/profile/setup',
    title: messages.navigation.profileSetupTitle,
    bootstrapScreen: 'profile-setup',
  },
  [AppRouteName.family]: {
    name: AppRouteName.family,
    path: '/family',
    title: messages.navigation.familyTitle,
    bootstrapScreen: 'family-management',
  },
  [AppRouteName.profile]: {
    name: AppRouteName.profile,
    path: '/profile',
    title: messages.navigation.profileTitle,
    bootstrapScreen: 'profile-edit',
  },
  [AppRouteName.security]: {
    name: AppRouteName.security,
    path: '/security',
    title: messages.navigation.securityTitle,
    bootstrapScreen: null,
  },
  [AppRouteName.newChild]: {
    name: AppRouteName.newChild,
    path: '/family/children/new',
    title: messages.navigation.newChildTitle,
    bootstrapScreen: 'child-create',
  },
  [AppRouteName.resetChildPassword]: {
    name: AppRouteName.resetChildPassword,
    path: '/family/children/:memberId/password',
    title: messages.navigation.resetChildPasswordTitle,
    bootstrapScreen: 'child-password-reset',
  },
  [AppRouteName.newParent]: {
    name: AppRouteName.newParent,
    path: '/family/parents/new',
    title: messages.navigation.newParentTitle,
    bootstrapScreen: null,
  },
};

export function isPublicRouteName(routeName: AppRouteName): boolean {
  return appRouteDefinitions[routeName].public === true;
}

export function isUnavailableRouteName(routeName: AppRouteName): boolean {
  return appRouteDefinitions[routeName].unavailable === true;
}

export function bootstrapScreenForRoute(routeName: AppRouteName): BootstrapPageScreen | null {
  return appRouteDefinitions[routeName].bootstrapScreen;
}
