import { principalFromResolution } from '../authorization/policy';
import { Capability } from '../../shared/authorizationCapabilities';
import {
  membershipHasCapability,
  memberContext,
  completedReplayAllowed,
} from '../authorization/enforcement';
import { HouseholdRole, MembershipActivationState } from './constants';
import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { IDEMPOTENCY_HEADER, ParentAccountError } from '../../shared/familyAccountContract';
import { getCognitoAdministration } from '../cognito/runtime';
import { authenticateRequest } from '../shared/auth';
import { messages } from '../shared/messages';
import { handleObservedRequest } from '../shared/request';
import {
  HttpStatus,
  errorResponse,
  noContentResponse,
  unauthorizedResponse,
  validationFailedResponse,
} from '../shared/responses';
import { CHILD_REMOVAL_ROUTE } from './childRemoval';
import {
  HouseholdErrorCode,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MembershipResolutionKind,
} from './constants';
import { membershipResolutionFailureResponse } from './authorization';
import { getHouseholdRepository } from './runtime';
import { PendingParentFailure } from './pendingParents';
import { parentAccountFailure, type ParentHandlerDependencies } from './parentHandlers';
/** Deactivate and purge application data before Cognito deletion; revocation spans the absent lookup. */
export async function handler(
  event: APIGatewayProxyEventV2,
  dependencies: ParentHandlerDependencies = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleObservedRequest(event, CHILD_REMOVAL_ROUTE, async (requestId) => {
    try {
      const identity = await authenticateRequest(event, dependencies.verifier);
      if (!identity) return unauthorizedResponse(requestId);
      const repository = dependencies.repository ?? getHouseholdRepository();
      const resolution = await repository.resolveMembership(identity.sub, identity.issuedAt);
      if (resolution.kind !== MembershipResolutionKind.active)
        return membershipResolutionFailureResponse(resolution, requestId);
      if (!membershipHasCapability(resolution.membership, Capability.childManage))
        throw new PendingParentFailure('unavailable');
      let value: unknown;
      try {
        value = JSON.parse(event.body ?? '');
      } catch {
        return errorResponse(
          HttpStatus.badRequest,
          ParentAccountError.invalidRequest,
          messages.parentAccounts.invalidRequest,
          requestId,
        );
      }
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).length !== 1 ||
        !('confirmation' in value) ||
        value.confirmation !== true
      )
        return validationFailedResponse(requestId, [
          {
            field: 'confirmation',
            code: ParentAccountError.invalidRequest,
            message: messages.parentAccounts.removeHelp,
          },
        ]);
      const key = Object.entries(event.headers ?? {}).find(
        ([k]) => k.toLowerCase() === IDEMPOTENCY_HEADER,
      )?.[1];
      if (!key || key.length > MAX_IDEMPOTENCY_KEY_LENGTH)
        return errorResponse(
          HttpStatus.badRequest,
          HouseholdErrorCode.invalidIdempotencyKey,
          messages.parentAccounts.invalidRequest,
          requestId,
        );
      const memberId = event.pathParameters?.memberId ?? '';
      const removal = repository.childRemoval;
      if (await removal.replay(identity.sub, key, memberId)) {
        if (
          !completedReplayAllowed(
            principalFromResolution(identity, resolution),
            Capability.childRemove,
          )
        )
          throw new PendingParentFailure('unavailable');
        return noContentResponse();
      }
      const householdId = resolution.membership.household.householdId;
      const target = await repository.getHouseholdMemberTarget(householdId, memberId);
      if (!target)
        return errorResponse(
          HttpStatus.notFound,
          HouseholdErrorCode.targetNotFound,
          messages.membershipApi.targetNotFound,
          requestId,
        );
      if (
        !membershipHasCapability(
          resolution.membership,
          Capability.childRemove,
          memberContext(householdId, target),
        )
      )
        return errorResponse(
          HttpStatus.forbidden,
          HouseholdErrorCode.targetNotManageable,
          messages.membershipApi.targetNotManageable,
          requestId,
        );
      const parents = (await repository.listFamilyMembers(householdId)).filter(
        (m) =>
          m.role === HouseholdRole.parent && m.activationState === MembershipActivationState.active,
      );
      const parentSubs: string[] = [];
      for (const parent of parents) {
        const p = await repository.getHouseholdMemberTarget(householdId, parent.memberId);
        if (!p) throw new PendingParentFailure('unavailable');
        parentSubs.push(p.sub);
      }
      const context = { householdId, target, owner: randomUUID(), parentSubs };
      await removal.begin(context);
      await removal.purge(context);
      // Cognito accepts immutable sub as Username; delayed calls cannot touch a reused username's new identity.
      await (dependencies.administration ?? getCognitoAdministration()).deleteUser(target.sub);
      await removal.complete(context, identity.sub, key);
      return noContentResponse();
    } catch (error) {
      return parentAccountFailure(error, requestId);
    }
  });
}
