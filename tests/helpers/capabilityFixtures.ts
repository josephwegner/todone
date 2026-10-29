import { Capability } from '../../shared/authorizationCapabilities';
/** Explicit presentation fixture contract. Server policy has independent exhaustive/endpoint tests. */
export const childCapabilities = [
  Capability.householdRead,
  Capability.profileSelfRead,
  Capability.profileSelfUpdate,
  Capability.directoryRead,
];
export const parentCapabilities = [
  ...childCapabilities,
  Capability.childCreate,
  Capability.parentCreate,
  Capability.childManage,
  Capability.recoveryEmailSelfManage,
];
export const profileAllowedActions = [Capability.profileRead, Capability.profileUpdate];
export const childAllowedActions = [Capability.childPasswordReset, Capability.childRemove];
export const pendingAllowedActions = [
  Capability.pendingParentCancel,
  Capability.pendingParentEmail,
  Capability.pendingParentResend,
];
