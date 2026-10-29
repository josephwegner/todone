import { Capability } from '../../shared/authorizationCapabilities';
import { decide, principalFromMembership } from '../authorization/policy';
import { membershipHasCapability, memberContext } from '../authorization/enforcement';
import { memberRepresentation } from '../authorization/projections';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { authenticateRequest } from '../shared/auth';
import { handleObservedRequest } from '../shared/request';
import { HttpStatus, json, unauthorizedResponse } from '../shared/responses';
import type { TokenVerifier } from '../session/verifier';
import { MembershipResolutionKind } from './constants';
import { membershipResolutionFailureResponse } from './authorization';
import type {
  CurrentMembership,
  FamilyDirectoryEntry,
  FamilyDirectoryMember,
  HouseholdRepository,
} from './model';
import { getHouseholdRepository } from './runtime';

const FAMILY_DIRECTORY_ROUTE = '/api/v1/family-members';

export interface DirectoryHandlerDependencies {
  repository: HouseholdRepository;
  verifier?: TokenVerifier;
}

/** API Gateway supplies a Cognito-verified `sub`; it alone selects the caller's household. */
export async function handler(
  event: APIGatewayProxyEventV2,
  dependencies?: DirectoryHandlerDependencies,
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleObservedRequest(event, FAMILY_DIRECTORY_ROUTE, async (requestId) => {
    const identity = await authenticateRequest(event, dependencies?.verifier);
    if (!identity) return unauthorizedResponse(requestId);

    const repository = dependencies?.repository ?? getHouseholdRepository();
    const resolution = await repository.resolveMembership(identity.sub, identity.issuedAt);
    if (resolution.kind !== MembershipResolutionKind.active)
      return membershipResolutionFailureResponse(resolution, requestId);
    const { membership } = resolution;
    if (!membershipHasCapability(membership, Capability.directoryRead))
      return membershipResolutionFailureResponse(
        { kind: MembershipResolutionKind.inactive },
        requestId,
      );
    const members = await repository.listFamilyMembers(membership.household.householdId);
    return json(HttpStatus.ok, { members: directoryForCaller(membership, members) });
  });
}

export function directoryForCaller(
  caller: CurrentMembership,
  members: FamilyDirectoryMember[],
): FamilyDirectoryEntry[] {
  const principal = principalFromMembership(caller);
  return members
    .filter(
      (member) =>
        decide(
          principal,
          Capability.memberRead,
          memberContext(caller.household.householdId, member),
        ).allowed,
    )
    .map((member) => memberRepresentation(caller, member));
}
