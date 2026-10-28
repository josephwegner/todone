import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { CognitoAdministration } from '../cognito/administration';
import {
  CognitoAdministrationError,
  CognitoAdministrationFailure,
  CognitoAdministrationOperation,
} from '../cognito/administration';
import { getCognitoAdministration } from '../cognito/runtime';
import { authenticateRequest } from '../shared/auth';
import { messages } from '../shared/messages';
import { handleObservedRequest } from '../shared/request';
import {
  errorResponse,
  HttpStatus,
  invalidJsonResponse,
  noContentResponse,
  unauthorizedResponse,
  validationFailedResponse,
} from '../shared/responses';
import type { TokenVerifier } from '../session/verifier';
import {
  isActiveParentMembership,
  isManageableChild,
  membershipResolutionFailureResponse,
} from './authorization';
import { HouseholdErrorCode, HouseholdField, MembershipResolutionKind } from './constants';
import type { HouseholdRepository } from './model';
import { getHouseholdRepository } from './runtime';

const ROUTE = '/api/v1/family-members/{memberId}/password';

export interface ResetChildPasswordHandlerDependencies {
  repository?: HouseholdRepository;
  administration?: CognitoAdministration;
  verifier?: TokenVerifier;
  now?: () => Date;
  /** The development emulator cannot revoke Cognito sessions; reject before changing credentials. */
  passwordResetAvailable?: boolean;
}

/** Resets a same-household child's password only after caller and target authorization. */
export async function handler(
  event: APIGatewayProxyEventV2,
  dependencies: ResetChildPasswordHandlerDependencies = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleObservedRequest(event, ROUTE, async (requestId) => {
    const identity = await authenticateRequest(event, dependencies.verifier);
    if (!identity) return unauthorizedResponse(requestId);
    const password = passwordFromRequest(event.body, requestId);
    if (typeof password !== 'string') return password;
    const memberId = event.pathParameters?.memberId;
    const repository = dependencies.repository ?? getHouseholdRepository();
    const resolution = await repository.resolveMembership(identity.sub, identity.issuedAt);
    if (resolution.kind !== MembershipResolutionKind.active)
      return membershipResolutionFailureResponse(resolution, requestId);
    const caller = resolution.membership;
    if (!isActiveParentMembership(caller))
      return errorResponse(
        HttpStatus.forbidden,
        HouseholdErrorCode.memberAccessUnavailable,
        messages.membershipApi.accessUnavailable,
        requestId,
      );
    if (!memberId)
      return errorResponse(
        HttpStatus.notFound,
        HouseholdErrorCode.targetNotFound,
        messages.membershipApi.targetNotFound,
        requestId,
      );
    let target;
    try {
      target = await repository.getHouseholdMemberTarget(caller.household.householdId, memberId);
    } catch {
      return errorResponse(
        HttpStatus.internalServerError,
        HouseholdErrorCode.internalError,
        messages.membershipApi.internalError,
        requestId,
      );
    }
    if (!target)
      return errorResponse(
        HttpStatus.notFound,
        HouseholdErrorCode.targetNotFound,
        messages.membershipApi.targetNotFound,
        requestId,
      );
    if (!isManageableChild(caller, target, caller.household.householdId))
      return errorResponse(
        HttpStatus.forbidden,
        HouseholdErrorCode.targetNotManageable,
        messages.membershipApi.targetNotManageable,
        requestId,
      );

    if (dependencies.passwordResetAvailable === false)
      return errorResponse(
        HttpStatus.serviceUnavailable,
        HouseholdErrorCode.passwordResetUnavailable,
        messages.membershipApi.localPasswordResetUnavailable,
        requestId,
      );

    try {
      const administration = dependencies.administration ?? getCognitoAdministration();
      await administration.setPermanentPassword(target.sub, password);
      await administration.globalSignOut(target.sub);
      await repository.advanceCredentialsValidAfter(
        target.sub,
        (dependencies.now ?? (() => new Date()))().toISOString(),
      );
      return noContentResponse();
    } catch (error) {
      if (
        error instanceof CognitoAdministrationError &&
        error.operation === CognitoAdministrationOperation.setPermanentPassword &&
        error.kind === CognitoAdministrationFailure.invalidPassword
      )
        return validationFailedResponse(requestId, [
          {
            field: HouseholdField.password,
            code: HouseholdErrorCode.invalidPassword,
            message: messages.membershipApi.invalidPassword,
          },
        ]);
      return errorResponse(
        HttpStatus.internalServerError,
        HouseholdErrorCode.internalError,
        messages.membershipApi.internalError,
        requestId,
      );
    }
  });
}

function passwordFromRequest(
  body: string | undefined,
  requestId: string,
): string | APIGatewayProxyStructuredResultV2 {
  let value: unknown;
  try {
    value = JSON.parse(body ?? '');
  } catch {
    return invalidJsonResponse(requestId);
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    !('password' in value) ||
    typeof value.password !== 'string' ||
    !value.password
  )
    return validationFailedResponse(requestId, [
      {
        field: HouseholdField.password,
        code: HouseholdErrorCode.invalidPassword,
        message: messages.membershipApi.invalidPassword,
      },
    ]);
  return value.password;
}
