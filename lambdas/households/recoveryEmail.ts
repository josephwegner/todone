import { Capability } from '../../shared/authorizationCapabilities';
import { membershipHasCapability, selfContext } from '../authorization/enforcement';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ParentAccountApi, ParentAccountError } from '../../shared/familyAccountContract';
import { authenticateRequest } from '../shared/auth';
import { messages } from '../shared/messages';
import { handleObservedRequest } from '../shared/request';
import {
  HttpStatus,
  errorResponse,
  json,
  unauthorizedResponse,
  validationFailedResponse,
} from '../shared/responses';
import { getCognitoAdministration } from '../cognito/runtime';
import { getHouseholdRepository } from './runtime';
import { MembershipResolutionKind } from './constants';
import { membershipResolutionFailureResponse } from './authorization';
import { parentAccountFailure, validEmail, type ParentHandlerDependencies } from './parentHandlers';
import { PendingParentFailure } from './pendingParents';
/** Cognito stages only email; verified-attribute retention and native verification own promotion. */
export async function handler(
  event: APIGatewayProxyEventV2,
  dependencies: ParentHandlerDependencies = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleObservedRequest(event, ParentAccountApi.recoveryEmail, async (requestId) => {
    try {
      const identity = await authenticateRequest(event, dependencies.verifier);
      if (!identity) return unauthorizedResponse(requestId);
      const repository = dependencies.repository ?? getHouseholdRepository();
      const resolution = await repository.resolveMembership(identity.sub, identity.issuedAt);
      if (resolution.kind !== MembershipResolutionKind.active)
        return membershipResolutionFailureResponse(resolution, requestId);
      if (
        !membershipHasCapability(
          resolution.membership,
          Capability.recoveryEmailManage,
          selfContext(resolution.membership),
        )
      )
        throw new PendingParentFailure('unavailable');
      if (event.requestContext.http.method === 'GET') {
        if (!validEmail(identity.email)) throw new PendingParentFailure('unavailable');
        return json(HttpStatus.ok, { email: identity.email });
      }
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
        Object.keys(value).some((k) => k !== 'email') ||
        !('email' in value) ||
        !validEmail(value.email)
      )
        return validationFailedResponse(requestId, [
          {
            field: 'email',
            code: ParentAccountError.invalidEmail,
            message: messages.parentAccounts.invalidEmail,
          },
        ]);
      if (dependencies.activationAvailable === false)
        return errorResponse(
          HttpStatus.serviceUnavailable,
          ParentAccountError.localRecoveryUnsupported,
          messages.parentAccounts.localRecoveryUnsupported,
          requestId,
        );
      await (dependencies.administration ?? getCognitoAdministration()).stageRecoveryEmail(
        resolution.membership.username,
        value.email,
      );
      return json(HttpStatus.accepted, {});
    } catch (error) {
      return parentAccountFailure(error, requestId);
    }
  });
}
