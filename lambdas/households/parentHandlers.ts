import { HouseholdRole, MembershipActivationState } from './constants';
import { randomUUID } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { CognitoAdministration } from '../cognito/administration';
import {
  CognitoAdministrationError,
  CognitoAdministrationFailure,
  CognitoAdministrationOperation,
} from '../cognito/administration';
import { getCognitoAdministration } from '../cognito/runtime';
import { authenticateRequest } from '../shared/auth';
import { handleObservedRequest } from '../shared/request';
import {
  errorResponse,
  HttpStatus,
  json,
  noContentResponse,
  unauthorizedResponse,
  validationFailedResponse,
} from '../shared/responses';
import { messages } from '../shared/messages';
import type { TokenVerifier } from '../session/verifier';
import {
  ParentAccountError,
  EMAIL_MAX_LENGTH,
  IDEMPOTENCY_HEADER,
} from '../../shared/familyAccountContract';
import {
  HouseholdErrorCode,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MembershipResolutionKind,
} from './constants';
import { isValidUsername, normalizeUsername } from './familyValidation';
import { membershipResolutionFailureResponse } from './authorization';
import { getHouseholdRepository } from './runtime';
import type { HouseholdRepository } from './model';
import {
  digestInput,
  PendingParentFailure,
  PendingParentRoute,
  proofMatches,
  type PendingReplay,
} from './pendingParents';
export interface ParentHandlerDependencies {
  repository?: HouseholdRepository;
  administration?: CognitoAdministration;
  verifier?: TokenVerifier;
  activationAvailable?: boolean;
}
const copy = messages.parentAccounts;
export function validEmail(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= EMAIL_MAX_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
    !/\p{Cc}/u.test(value)
  );
}
function body(event: APIGatewayProxyEventV2, fields: string[]): Record<string, unknown> {
  const value: unknown = JSON.parse(event.body ?? '{}');
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !fields.includes(k))
  )
    throw new PendingParentFailure('unavailable');
  return value as Record<string, unknown>;
}
class InvalidParentRequest extends Error {
  readonly code = HouseholdErrorCode.invalidIdempotencyKey;
}
function key(event: APIGatewayProxyEventV2): string {
  const value = Object.entries(event.headers ?? {}).find(
    ([k]) => k.toLowerCase() === IDEMPOTENCY_HEADER,
  )?.[1];
  if (!value || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) throw new InvalidParentRequest();
  return value;
}
export function parentAccountFailure(
  error: unknown,
  requestId: string,
): APIGatewayProxyStructuredResultV2 {
  if (error instanceof InvalidParentRequest)
    return errorResponse(HttpStatus.badRequest, error.code, copy.invalidRequest, requestId);
  if (error instanceof PendingParentFailure) {
    const status = error.kind === 'conflict' ? HttpStatus.conflict : HttpStatus.forbidden;
    return errorResponse(status, ParentAccountError[error.kind], copy[error.kind], requestId);
  }
  if (
    error instanceof CognitoAdministrationError &&
    error.kind === CognitoAdministrationFailure.usernameConflict
  )
    return errorResponse(
      HttpStatus.conflict,
      HouseholdErrorCode.usernameConflict,
      messages.membershipApi.usernameConflict,
      requestId,
      [
        {
          field: 'username',
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
/** Cognito delivery is attempted only after active-parent authorization and completed-replay lookup. */
export async function createParentHandler(
  event: APIGatewayProxyEventV2,
  dependencies: ParentHandlerDependencies = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleObservedRequest(event, PendingParentRoute.create, async (requestId) => {
    try {
      const identity = await authenticateRequest(event, dependencies.verifier);
      if (!identity) return unauthorizedResponse(requestId);
      const repository = dependencies.repository ?? getHouseholdRepository();
      const resolution = await repository.resolveMembership(identity.sub, identity.issuedAt);
      if (resolution.kind !== MembershipResolutionKind.active)
        return membershipResolutionFailureResponse(resolution, requestId);
      if (resolution.membership.role !== HouseholdRole.parent)
        throw new PendingParentFailure('unavailable');
      let value: Record<string, unknown>;
      try {
        value = body(event, ['username', 'email']);
      } catch {
        return errorResponse(
          HttpStatus.badRequest,
          ParentAccountError.invalidRequest,
          copy.invalidRequest,
          requestId,
        );
      }
      const username = typeof value.username === 'string' ? normalizeUsername(value.username) : '';
      if (!isValidUsername(username))
        return validationFailedResponse(requestId, [
          {
            field: 'username',
            code: HouseholdErrorCode.invalidUsername,
            message: messages.parentAccounts.invalidRequest,
          },
        ]);
      if (!validEmail(value.email))
        return validationFailedResponse(requestId, [
          { field: 'email', code: ParentAccountError.invalidEmail, message: copy.invalidEmail },
        ]);
      const input = {
        callerSub: identity.sub,
        householdId: resolution.membership.household.householdId,
        username,
        email: value.email,
        idempotencyKey: key(event),
      };
      const p = repository.pendingParents;
      const replay = await p.replay(p.provisionReplay(input));
      if (replay) {
        const members = await repository.listFamilyMembers(input.householdId);
        const member = members.find((m) => m.memberId === replay.memberId);
        if (!member) throw new PendingParentFailure('unavailable');
        return json(HttpStatus.ok, { member });
      }
      const administration = dependencies.administration ?? getCognitoAdministration();
      const created = await administration.createUser({
        kind: 'pending-parent',
        username,
        email: input.email,
      });
      return json(HttpStatus.created, { member: await p.provision(input, created.sub) });
    } catch (error) {
      return parentAccountFailure(error, requestId);
    }
  });
}
/** Only verified self claims plus the guarded current binding authorize this atomic transition. */
export async function activateParentHandler(
  event: APIGatewayProxyEventV2,
  dependencies: ParentHandlerDependencies = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  return handleObservedRequest(event, PendingParentRoute.activation, async (requestId) => {
    try {
      const identity = await authenticateRequest(event, dependencies.verifier);
      if (!identity) return unauthorizedResponse(requestId);
      if (
        event.body ||
        Object.keys(event.pathParameters ?? {}).length ||
        Object.keys(event.queryStringParameters ?? {}).length
      )
        return errorResponse(
          HttpStatus.badRequest,
          ParentAccountError.invalidRequest,
          copy.invalidRequest,
          requestId,
        );
      const repository = dependencies.repository ?? getHouseholdRepository();
      const resolution = await repository.resolveMembership(identity.sub, identity.issuedAt);
      if (resolution.kind === MembershipResolutionKind.active) {
        if (resolution.membership.role !== HouseholdRole.parent)
          throw new PendingParentFailure('unavailable');
        return json(HttpStatus.ok, { membership: resolution.membership });
      }
      if (resolution.kind !== MembershipResolutionKind.pendingActivation)
        return membershipResolutionFailureResponse(resolution, requestId);
      if (dependencies.activationAvailable === false)
        return errorResponse(
          HttpStatus.serviceUnavailable,
          ParentAccountError.localUnsupported,
          copy.localUnsupported,
          requestId,
        );
      const p = repository.pendingParents,
        context = await p.context(identity.sub),
        owner = randomUUID();
      await p.acquire(context, owner);
      if (!proofMatches(context, identity.email, identity.emailVerified)) {
        await p.release(context, owner);
        throw new PendingParentFailure('unproven');
      }
      return json(HttpStatus.ok, { membership: await p.activate(context, owner) });
    } catch (error) {
      return parentAccountFailure(error, requestId);
    }
  });
}
/** All external pending-account mutations retain exclusive ownership until a confirmed final write. */
export async function pendingParentActionHandler(
  event: APIGatewayProxyEventV2,
  dependencies: ParentHandlerDependencies = {},
): Promise<APIGatewayProxyStructuredResultV2> {
  const action =
    event.requestContext.http.method === 'DELETE'
      ? 'cancel'
      : event.requestContext.http.method === 'PUT'
        ? 'email'
        : 'resend';
  const route = PendingParentRoute[action];
  return handleObservedRequest(event, route, async (requestId) => {
    try {
      const identity = await authenticateRequest(event, dependencies.verifier);
      if (!identity) return unauthorizedResponse(requestId);
      const repository = dependencies.repository ?? getHouseholdRepository();
      const resolution = await repository.resolveMembership(identity.sub, identity.issuedAt);
      if (resolution.kind !== MembershipResolutionKind.active)
        return membershipResolutionFailureResponse(resolution, requestId);
      if (resolution.membership.role !== HouseholdRole.parent)
        throw new PendingParentFailure('unavailable');
      let value: Record<string, unknown>;
      try {
        value = body(
          event,
          action === 'email' ? ['email'] : action === 'cancel' ? ['confirmation'] : [],
        );
      } catch {
        return errorResponse(
          HttpStatus.badRequest,
          ParentAccountError.invalidRequest,
          copy.invalidRequest,
          requestId,
        );
      }
      if (action === 'email' && !validEmail(value.email))
        return validationFailedResponse(requestId, [
          { field: 'email', code: ParentAccountError.invalidEmail, message: copy.invalidEmail },
        ]);
      if (action === 'cancel' && value.confirmation !== true)
        return validationFailedResponse(requestId, [
          {
            field: 'confirmation',
            code: ParentAccountError.invalidRequest,
            message: copy.cancelConfirmation,
          },
        ]);
      const targetId = event.pathParameters?.memberId ?? '';
      const replay: PendingReplay = {
        callerSub: identity.sub,
        route,
        target: targetId,
        key: key(event),
        digest: digestInput(
          action,
          targetId,
          action === 'email' ? (value.email as string) : action === 'cancel' ? 'true' : '',
        ),
      };
      const p = repository.pendingParents;
      if (await p.replay(replay)) return noContentResponse();
      const target = await repository.getHouseholdMemberTarget(
        resolution.membership.household.householdId,
        targetId,
      );
      if (!target)
        return errorResponse(
          HttpStatus.notFound,
          HouseholdErrorCode.targetNotFound,
          messages.membershipApi.targetNotFound,
          requestId,
        );
      if (
        target.role !== HouseholdRole.parent ||
        target.activationState !== MembershipActivationState.pendingActivation
      )
        throw new PendingParentFailure('unavailable');
      const context = await p.context(target.sub),
        owner = randomUUID();
      await p.acquire(context, owner);
      const administration = dependencies.administration ?? getCognitoAdministration();
      if (action !== 'cancel') {
        let eligible: boolean;
        try {
          eligible = await administration.canResendWelcome(context.sub);
        } catch (error) {
          // This read cannot change Cognito; no mutation has begun under this owner.
          await p.release(context, owner);
          throw error;
        }
        if (!eligible) {
          await p.release(context, owner);
          return errorResponse(
            HttpStatus.conflict,
            ParentAccountError.welcomeUnavailable,
            copy.welcomeUnavailable,
            requestId,
          );
        }
      }
      // Unknown or partial dependency failures deliberately leave the guard held for operator repair.
      try {
        // Immutable sub prevents a delayed SDK retry from deleting a reused username's new identity.
        if (action === 'cancel') await administration.deleteUser(context.sub);
        else {
          if (action === 'email')
            await administration.updatePendingParentEmail(context.username, value.email as string);
          await administration.resendWelcome(context.username);
        }
      } catch (error) {
        if (
          action === 'resend' &&
          error instanceof CognitoAdministrationError &&
          error.operation === CognitoAdministrationOperation.resendWelcome &&
          (error.kind === CognitoAdministrationFailure.throttled ||
            error.kind === CognitoAdministrationFailure.invalidState)
        ) {
          await p.release(context, owner);
          if (error.kind === CognitoAdministrationFailure.throttled)
            return errorResponse(429, ParentAccountError.conflict, copy.conflict, requestId);
          return errorResponse(
            HttpStatus.conflict,
            ParentAccountError.welcomeUnavailable,
            copy.welcomeUnavailable,
            requestId,
          );
        }
        throw error;
      }
      await p.finish(context, owner, replay, action, value.email as string | undefined);
      return noContentResponse();
    } catch (error) {
      return parentAccountFailure(error, requestId);
    }
  });
}
