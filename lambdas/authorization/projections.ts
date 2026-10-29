import { Capability } from '../../shared/authorizationCapabilities';
import { allowedActions, principalCapabilities, principalFromMembership } from './policy';
import { memberContext, selfContext } from './enforcement';
import type { CurrentMembership, FamilyDirectoryMember } from '../households/model';
export function membershipRepresentation(membership: CurrentMembership) {
  return {
    ...membership,
    capabilities: principalCapabilities(principalFromMembership(membership)),
  };
}
export function memberRepresentation(caller: CurrentMembership, member: FamilyDirectoryMember) {
  return {
    ...member,
    allowedActions: allowedActions(
      principalFromMembership(caller),
      memberContext(caller.household.householdId, member),
    ).filter(
      (key) =>
        key !== Capability.memberRead &&
        key !== Capability.profileRead &&
        key !== Capability.recoveryEmailManage,
    ),
  };
}
export function profileActions(membership: CurrentMembership) {
  return allowedActions(principalFromMembership(membership), selfContext(membership)).filter(
    (key) => key === Capability.profileRead || key === Capability.profileUpdate,
  );
}
