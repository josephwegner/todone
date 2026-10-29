import { memberRepresentation } from '../authorization/projections';
import { principalFromResolution } from '../authorization/policy';
import { Capability } from '../../shared/authorizationCapabilities';
import { membershipHasCapability, completedReplayAllowed } from '../authorization/enforcement';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { CognitoAdministration } from '../cognito/administration';
import { CognitoAdministrationFailure, CognitoUserKind } from '../cognito/administration';
import { getCognitoAdministration } from '../cognito/runtime';
import { authenticateRequest } from '../shared/auth';
import { messages } from '../shared/messages';
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
import { membershipResolutionFailureResponse } from './authorization';
import {
  HouseholdErrorCode,
  HouseholdField,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MembershipResolutionKind,
  type ProfileColorId,
} from './constants';
import {
  isCanonicalProfileColor,
  isValidUsername,
  normalizeUsername,
  usernameValidationMessage,
} from './familyValidation';
import type { HouseholdRepository } from './model';
import { getHouseholdRepository } from './runtime';

const ROUTE = '/api/v1/family-members/children';

export interface ChildHandlerDependencies {
  repository?: HouseholdRepository;
  administration?: CognitoAdministration;
  verifier?: TokenVerifier;
}

/** Cognito is invoked only after the verified caller resolves as an active parent. */
export async function handler(
  event: APIGatewayProxyEventV2,
  dependencies?: ChildHandlerDependencies,
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleObservedRequest(event, ROUTE, async (requestId) => {
    const identity = await authenticateRequest(event, dependencies?.verifier);
    if (!identity) return unauthorizedResponse(requestId);
    const idempotencyKey = Object.entries(event.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'idempotency-key',
    )?.[1];
    if (!idempotencyKey || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH)
      return errorResponse(
        HttpStatus.badRequest,
        HouseholdErrorCode.invalidIdempotencyKey,
        'The idempotency key is invalid.',
        requestId,
      );
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '');
    } catch {
      return invalidJsonResponse(requestId);
    }
    const value = validateChild(body);
    if ('fieldErrors' in value) return validationFailedResponse(requestId, value.fieldErrors);
    const repository = dependencies?.repository ?? getHouseholdRepository();
    const resolution = await repository.resolveMembership(identity.sub, identity.issuedAt);
    if (resolution.kind !== MembershipResolutionKind.active)
      return membershipResolutionFailureResponse(resolution, requestId);
    const caller = resolution.membership;
    if (!membershipHasCapability(caller, Capability.childCreate))
      return errorResponse(
        HttpStatus.forbidden,
        HouseholdErrorCode.memberAccessUnavailable,
        'Member access is unavailable.',
        requestId,
      );
    let replay;
    try {
      replay = await repository.findChildProvisionReplay({
        callerSub: identity.sub,
        householdId: caller.household.householdId,
        username: value.username,
        displayName: value.displayName,
        color: value.color,
        idempotencyKey,
      });
    } catch {
      return errorResponse(
        HttpStatus.internalServerError,
        HouseholdErrorCode.internalError,
        messages.membershipApi.internalError,
        requestId,
      );
    }
    if (replay?.kind === 'idempotency-conflict')
      return errorResponse(
        HttpStatus.conflict,
        HouseholdErrorCode.idempotencyConflict,
        'The idempotency key was already used with different input.',
        requestId,
      );
    if (replay?.kind === 'replayed') {
      if (
        !completedReplayAllowed(
          principalFromResolution(identity, resolution),
          Capability.childCreate,
        )
      )
        return membershipResolutionFailureResponse(
          { kind: MembershipResolutionKind.inactive },
          requestId,
        );
      return json(HttpStatus.ok, { member: memberRepresentation(caller, replay.member) });
    }
    const administration = dependencies?.administration ?? getCognitoAdministration();
    try {
      const created = await administration.createUser({
        kind: CognitoUserKind.child,
        username: value.username,
      });
      await administration.setPermanentPassword(value.username, value.password);
      const result = await repository.provisionChild({
        callerSub: identity.sub,
        householdId: caller.household.householdId,
        childSub: created.sub,
        username: value.username,
        displayName: value.displayName,
        color: value.color,
        idempotencyKey,
      });
      if (result.kind === 'idempotency-conflict')
        return errorResponse(
          HttpStatus.conflict,
          HouseholdErrorCode.idempotencyConflict,
          'The idempotency key was already used with different input.',
          requestId,
        );
      return json(result.kind === 'created' ? HttpStatus.created : HttpStatus.ok, {
        member: memberRepresentation(caller, result.member),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        'kind' in error &&
        (error as { kind?: string }).kind === CognitoAdministrationFailure.usernameConflict
      )
        return errorResponse(
          HttpStatus.conflict,
          HouseholdErrorCode.usernameConflict,
          messages.membershipApi.usernameConflict,
          requestId,
          [
            {
              field: HouseholdField.username,
              code: HouseholdErrorCode.usernameConflict,
              message: messages.membershipApi.usernameConflict,
            },
          ],
        );
      return errorResponse(
        HttpStatus.internalServerError,
        HouseholdErrorCode.internalError,
        messages.membershipApi.internalError,
        requestId,
      );
    }
  });
}

function validateChild(
  value: unknown,
):
  | { username: string; displayName: string; color: ProfileColorId; password: string }
  | { fieldErrors: Array<{ field: string; code: string; message: string }> } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {
      fieldErrors: [
        {
          field: HouseholdField.username,
          code: HouseholdErrorCode.invalidRequest,
          message: 'The request contains unsupported fields.',
        },
      ],
    };
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some((key) => !['username', 'displayName', 'color', 'password'].includes(key))
  )
    return {
      fieldErrors: [
        {
          field: HouseholdField.username,
          code: HouseholdErrorCode.invalidRequest,
          message: 'The request contains unsupported fields.',
        },
      ],
    };
  const username = typeof body.username === 'string' ? normalizeUsername(body.username) : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const errors = [] as Array<{ field: string; code: string; message: string }>;
  if (!isValidUsername(username))
    errors.push({
      field: HouseholdField.username,
      code: HouseholdErrorCode.invalidUsername,
      message: usernameValidationMessage(),
    });
  if (!displayName || [...displayName].length > 60 || /\p{Cc}/u.test(displayName))
    errors.push({
      field: HouseholdField.displayName,
      code: HouseholdErrorCode.invalidDisplayName,
      message: 'The display name is invalid.',
    });
  if (!isCanonicalProfileColor(body.color))
    errors.push({
      field: HouseholdField.color,
      code: HouseholdErrorCode.invalidProfileColor,
      message: 'The profile color is invalid.',
    });
  if (typeof body.password !== 'string' || !body.password)
    errors.push({
      field: 'password',
      code: HouseholdErrorCode.invalidRequest,
      message: 'A password is required.',
    });
  return errors.length
    ? { fieldErrors: errors }
    : {
        username,
        displayName,
        color: body.color as ProfileColorId,
        password: body.password as string,
      };
}
