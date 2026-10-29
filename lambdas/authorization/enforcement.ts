import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { Capability, type CapabilityKey } from '../../shared/authorizationCapabilities';
import { errorResponse, HttpStatus, unauthorizedResponse } from '../shared/responses';
import { messages } from '../shared/messages';
import { HouseholdErrorCode } from '../households/constants';
import type {
  CurrentMembership,
  FamilyDirectoryMember,
  HouseholdMemberTarget,
} from '../households/model';
import { decide, principalFromMembership, type PolicyContext, type Principal } from './policy';
import { emitAuthorizationDecision } from '../shared/metrics';

/** Logs only registry-controlled keys and coarse outcomes, never supplied identifiers or context. */
export function enforceCapability(
  principal: Principal,
  key: CapabilityKey,
  context?: PolicyContext,
): boolean {
  const decision = decide(principal, key, context);
  emitAuthorizationDecision(key, decision.allowed);
  return decision.allowed;
}
export function membershipHasCapability(
  membership: CurrentMembership,
  key: CapabilityKey,
  context?: PolicyContext,
  sub = '',
): boolean {
  return enforceCapability(principalFromMembership(membership, sub), key, context);
}
export function selfContext(
  membership: CurrentMembership,
): Extract<PolicyContext, { kind: 'self' }> {
  return {
    kind: 'self',
    householdId: membership.household.householdId,
    memberId: membership.memberId,
  };
}
/** The target must have come from this household's scoped repository lookup. */
export function memberContext(
  householdId: string,
  target: FamilyDirectoryMember | HouseholdMemberTarget,
): Extract<PolicyContext, { kind: 'member' }> {
  return {
    kind: 'member',
    householdId,
    memberId: target.memberId,
    role: target.role,
    activationState: target.activationState,
  };
}
/** Call only after a repository validates a completed caller/route/key/target/payload receipt. */
export function completedReplayAllowed(principal: Principal, operation: CapabilityKey): boolean {
  if (!('sub' in principal)) return false;
  return enforceCapability(principal, Capability.completedReplay, {
    kind: 'receipt',
    callerSub: principal.sub,
    operation,
    completed: true,
    requestMatched: true,
  });
}
export function capabilityFailureResponse(
  principal: Principal,
  requestId: string,
  targetHidden = false,
): APIGatewayProxyStructuredResultV2 {
  if (principal.kind === 'anonymous') return unauthorizedResponse(requestId);
  if (targetHidden)
    return errorResponse(
      HttpStatus.notFound,
      HouseholdErrorCode.targetNotFound,
      messages.membershipApi.targetNotFound,
      requestId,
    );
  if (principal.kind === 'credentials-stale')
    return errorResponse(
      HttpStatus.unauthorized,
      HouseholdErrorCode.sessionReauthenticationRequired,
      messages.membershipApi.reauthenticationRequired,
      requestId,
    );
  if (principal.kind === 'inconsistent')
    return errorResponse(
      HttpStatus.internalServerError,
      HouseholdErrorCode.internalError,
      messages.membershipApi.internalError,
      requestId,
    );
  return errorResponse(
    HttpStatus.forbidden,
    HouseholdErrorCode.memberAccessUnavailable,
    messages.membershipApi.accessUnavailable,
    requestId,
  );
}
