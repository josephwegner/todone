import { HouseholdErrorCode, MembershipResolutionKind } from './constants';
import { errorResponse, HttpStatus } from '../shared/responses';
import { messages } from '../shared/messages';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { MembershipResolution } from './model';

/** Maps non-active Membership outcomes without exposing state or stored identity values. */
export function membershipResolutionFailureResponse(
  resolution: Exclude<MembershipResolution, { kind: 'active' }>,
  requestId: string,
): APIGatewayProxyStructuredResultV2 {
  if (resolution.kind === MembershipResolutionKind.credentialsStale) {
    return errorResponse(
      HttpStatus.unauthorized,
      HouseholdErrorCode.sessionReauthenticationRequired,
      messages.membershipApi.reauthenticationRequired,
      requestId,
    );
  }
  if (resolution.kind === MembershipResolutionKind.inconsistent) {
    return errorResponse(
      HttpStatus.internalServerError,
      HouseholdErrorCode.internalError,
      messages.membershipApi.internalError,
      requestId,
    );
  }
  return errorResponse(
    HttpStatus.forbidden,
    HouseholdErrorCode.memberAccessUnavailable,
    messages.membershipApi.accessUnavailable,
    requestId,
  );
}
