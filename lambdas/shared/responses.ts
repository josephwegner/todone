import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const JSON_NO_STORE_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

export interface ApiFieldError {
  field: string;
  code: string;
  message: string;
}

export const ApiErrorCode = {
  unauthorized: 'UNAUTHORIZED',
  invalidJson: 'INVALID_JSON',
  validationFailed: 'VALIDATION_FAILED',
} as const;

export const HttpStatus = {
  ok: 200,
  created: 201,
  accepted: 202,
  noContent: 204,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  unprocessableContent: 422,
  internalServerError: 500,
  serviceUnavailable: 503,
} as const;

export function json(statusCode: number, value: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: JSON_NO_STORE_HEADERS, body: JSON.stringify(value) };
}

export function noContentResponse(): APIGatewayProxyStructuredResultV2 {
  return { statusCode: HttpStatus.noContent, headers: { 'cache-control': 'no-store' } };
}

export function errorResponse(
  statusCode: number,
  code: string,
  message: string,
  requestId: string,
  fieldErrors?: ApiFieldError[],
): APIGatewayProxyStructuredResultV2 {
  return json(statusCode, {
    error: { code, message, requestId, ...(fieldErrors ? { fieldErrors } : {}) },
  });
}

export function unauthorizedResponse(requestId: string): APIGatewayProxyStructuredResultV2 {
  return errorResponse(
    HttpStatus.unauthorized,
    ApiErrorCode.unauthorized,
    'Authentication is required.',
    requestId,
  );
}

export function invalidJsonResponse(requestId: string): APIGatewayProxyStructuredResultV2 {
  return errorResponse(
    400,
    ApiErrorCode.invalidJson,
    'The request body must be valid JSON.',
    requestId,
  );
}

export function validationFailedResponse(
  requestId: string,
  fieldErrors: ApiFieldError[],
): APIGatewayProxyStructuredResultV2 {
  return errorResponse(
    422,
    ApiErrorCode.validationFailed,
    'The request contains invalid fields.',
    requestId,
    fieldErrors,
  );
}
