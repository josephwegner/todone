/** Stable external action vocabulary. Values are hints, never bearer grants. */
export const Capability = {
  householdBootstrap: 'household.bootstrap',
  householdRead: 'household.read',
  profileSelfRead: 'profile.self.read',
  profileSelfUpdate: 'profile.self.update',
  profileRead: 'profile.read',
  profileUpdate: 'profile.update',
  directoryRead: 'family.directory.read',
  memberRead: 'family.member.read',
  childCreate: 'family.child.create',
  parentCreate: 'family.parent.create',
  childManage: 'family.child.manage',
  childPasswordReset: 'family.child.password.reset',
  childRemove: 'family.child.remove',
  pendingParentResend: 'family.pending-parent.resend-welcome',
  pendingParentEmail: 'family.pending-parent.change-email-and-resend',
  pendingParentCancel: 'family.pending-parent.cancel',
  parentSelfActivate: 'family.parent.self.activate',
  recoveryEmailSelfManage: 'security.recovery-email.self.manage',
  recoveryEmailManage: 'security.recovery-email.manage',
  completedReplay: 'request.completed.replay',
} as const;
export type CapabilityKey = (typeof Capability)[keyof typeof Capability];
export type CapabilityScope = 'principal' | 'self' | 'member' | 'activation' | 'receipt';
export const capabilityRegistry = {
  [Capability.householdBootstrap]: 'principal',
  [Capability.householdRead]: 'principal',
  [Capability.profileSelfRead]: 'principal',
  [Capability.profileSelfUpdate]: 'principal',
  [Capability.profileRead]: 'self',
  [Capability.profileUpdate]: 'self',
  [Capability.directoryRead]: 'principal',
  [Capability.memberRead]: 'member',
  [Capability.childCreate]: 'principal',
  [Capability.parentCreate]: 'principal',
  [Capability.childManage]: 'principal',
  [Capability.childPasswordReset]: 'member',
  [Capability.childRemove]: 'member',
  [Capability.pendingParentResend]: 'member',
  [Capability.pendingParentEmail]: 'member',
  [Capability.pendingParentCancel]: 'member',
  [Capability.parentSelfActivate]: 'activation',
  [Capability.recoveryEmailSelfManage]: 'principal',
  [Capability.recoveryEmailManage]: 'self',
  [Capability.completedReplay]: 'receipt',
} as const satisfies Record<CapabilityKey, CapabilityScope>;
export const capabilityKeys = Object.values(Capability);
export function isCapabilityKey(value: unknown): value is CapabilityKey {
  return typeof value === 'string' && Object.hasOwn(capabilityRegistry, value);
}
/** Ignores unknown additive keys, removes duplicates, and uses deterministic code-point order. */
export function serializeCapabilities(values: readonly unknown[]): CapabilityKey[] {
  return [...new Set(values.filter(isCapabilityKey))].sort();
}
export function hasCapability(values: readonly unknown[] | undefined, key: CapabilityKey): boolean {
  return values?.includes(key) === true;
}
