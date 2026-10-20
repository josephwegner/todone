import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { authenticateRequest } from '../shared/auth';
import { handleObservedRequest } from '../shared/request';
import { errorResponse, HttpStatus, json, unauthorizedResponse } from '../shared/responses';
import type { TokenVerifier } from '../session/verifier';
import type { HouseholdRepository } from './model';
import { getHouseholdRepository } from './runtime';
import { membershipResolutionFailureResponse } from './authorization';
import { MembershipResolutionKind } from './constants';
import { CurrentMembershipApi } from '../../shared/membershipContract';
import { messages } from '../shared/messages';

export interface CurrentHandlerDependencies {
  repository: HouseholdRepository;
  verifier?: TokenVerifier;
}

export async function handler(
  event: APIGatewayProxyEventV2,
  dependencies?: CurrentHandlerDependencies,
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleObservedRequest(event, CurrentMembershipApi.path, async (requestId) => {
    const identity = await authenticateRequest(event, dependencies?.verifier);
    if (!identity) return unauthorizedResponse(requestId);

    const repository = dependencies?.repository ?? getHouseholdRepository();
    const resolution = await repository.resolveMembership(identity.sub, identity.issuedAt);
    if (resolution.kind === MembershipResolutionKind.unattached)
      return json(200, { membership: null });
    if (resolution.kind === MembershipResolutionKind.active)
      return json(200, { membership: resolution.membership });
    // This authenticated self-read discloses only the caller's outcome. Other
    // protected operations retain the generic membership-denial contract.
    if (resolution.kind === MembershipResolutionKind.pendingActivation) {
      return errorResponse(
        HttpStatus.forbidden,
        CurrentMembershipApi.pendingActivation,
        messages.membershipApi.pendingActivation,
        requestId,
      );
    }
    if (resolution.kind === MembershipResolutionKind.inactive) {
      return errorResponse(
        HttpStatus.forbidden,
        CurrentMembershipApi.inactive,
        messages.membershipApi.inactive,
        requestId,
      );
    }
    if (resolution.kind === MembershipResolutionKind.inconsistent) {
      return errorResponse(
        HttpStatus.internalServerError,
        CurrentMembershipApi.inconsistent,
        messages.membershipApi.internalError,
        requestId,
      );
    }
    return membershipResolutionFailureResponse(resolution, requestId);
  });
}
