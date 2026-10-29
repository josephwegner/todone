import { Capability } from '../../shared/authorizationCapabilities';
import { membershipHasCapability, selfContext } from '../authorization/enforcement';
import { profileActions } from '../authorization/projections';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { authenticateRequest } from '../shared/auth';
import { handleObservedRequest } from '../shared/request';
import {
  errorResponse,
  HttpStatus,
  invalidJsonResponse,
  json,
  unauthorizedResponse,
  validationFailedResponse,
} from '../shared/responses';
import type { TokenVerifier } from '../session/verifier';
import { HouseholdErrorCode, MembershipResolutionKind } from './constants';
import { membershipResolutionFailureResponse } from './authorization';
import { validateProfileInput } from './familyValidation';
import type { HouseholdRepository } from './model';
import { getHouseholdRepository } from './runtime';
import { messages } from '../shared/messages';

const PROFILE_ROUTE = '/api/v1/profiles/me';

export interface ProfileHandlerDependencies {
  repository: HouseholdRepository;
  verifier?: TokenVerifier;
}

export async function readHandler(
  event: APIGatewayProxyEventV2,
  dependencies?: ProfileHandlerDependencies,
): Promise<APIGatewayProxyStructuredResultV2> {
  // API Gateway invokes this after validating the Cognito-issued JWT. We resolve
  // its verified `sub` to Membership rather than accepting target identifiers.
  return handleObservedRequest(event, PROFILE_ROUTE, async (requestId) => {
    const identity = await authenticateRequest(event, dependencies?.verifier);
    if (!identity) return unauthorizedResponse(requestId);

    const repository = dependencies?.repository ?? getHouseholdRepository();
    const resolution = await repository.resolveMembership(identity.sub, identity.issuedAt);
    if (resolution.kind !== MembershipResolutionKind.active)
      return membershipResolutionFailureResponse(resolution, requestId);
    const { membership } = resolution;
    if (!membershipHasCapability(membership, Capability.profileRead, selfContext(membership)))
      return membershipResolutionFailureResponse(
        { kind: MembershipResolutionKind.inactive },
        requestId,
      );
    const profile = await repository.getProfile(
      membership.household.householdId,
      membership.memberId,
    );
    return json(HttpStatus.ok, { profile, allowedActions: profileActions(membership) });
  });
}

export async function updateHandler(
  event: APIGatewayProxyEventV2,
  dependencies?: ProfileHandlerDependencies,
): Promise<APIGatewayProxyStructuredResultV2> {
  // API Gateway supplies the same verified Cognito identity for writes. The
  // repository receives only that member's derived household/member IDs.
  return handleObservedRequest(event, PROFILE_ROUTE, async (requestId) => {
    const identity = await authenticateRequest(event, dependencies?.verifier);
    if (!identity) return unauthorizedResponse(requestId);

    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '');
    } catch {
      return invalidJsonResponse(requestId);
    }
    const validation = validateProfileInput(body);
    if (validation.kind === 'invalid') {
      return validationFailedResponse(requestId, validation.fieldErrors);
    }

    const repository = dependencies?.repository ?? getHouseholdRepository();
    const resolution = await repository.resolveMembership(identity.sub, identity.issuedAt);
    if (resolution.kind !== MembershipResolutionKind.active)
      return membershipResolutionFailureResponse(resolution, requestId);
    const { membership } = resolution;
    if (!membershipHasCapability(membership, Capability.profileUpdate, selfContext(membership)))
      return membershipResolutionFailureResponse(
        { kind: MembershipResolutionKind.inactive },
        requestId,
      );
    const result = await repository.saveProfile({
      householdId: membership.household.householdId,
      memberId: membership.memberId,
      ...validation.value,
    });
    if (result.kind === 'conflict') {
      return errorResponse(
        HttpStatus.conflict,
        HouseholdErrorCode.profileConflict,
        messages.profileApi.conflict,
        requestId,
      );
    }
    return json(result.kind === 'created' ? HttpStatus.created : HttpStatus.ok, {
      profile: result.profile,
      allowedActions: profileActions(membership),
    });
  });
}
