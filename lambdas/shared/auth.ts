import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createCognitoVerifier, type TokenVerifier } from '../session/verifier';

export interface AuthenticatedIdentity {
  sub: string;
  username: string;
  issuedAt?: number;
  email?: string;
  emailVerified?: boolean;
}

let cachedVerifier: TokenVerifier | null = null;
const AuthHeader = {
  authorization: 'authorization',
  authorizationLegacy: 'Authorization',
} as const;
const CognitoClaim = { subject: 'sub', username: 'cognito:username' } as const;
const EnvironmentVariable = {
  cognitoUserPoolId: 'COGNITO_USER_POOL_ID',
  cognitoClientId: 'COGNITO_CLIENT_ID',
  cognitoLocalEndpoint: 'COGNITO_LOCAL_ENDPOINT',
} as const;

export async function authenticateRequest(
  event: APIGatewayProxyEventV2,
  verifierOverride?: TokenVerifier,
): Promise<AuthenticatedIdentity | null> {
  const gatewayIdentity = gatewayAuthorizerIdentity(event);
  if (gatewayIdentity.kind === 'valid') return gatewayIdentity.identity;
  if (gatewayIdentity.kind === 'invalid') return null;

  const token = bearerToken(event.headers ?? {});
  if (!token) return null;
  try {
    const verifier = verifierOverride ?? getVerifier();
    const claims = await verifier.verify(token);
    return {
      sub: claims.sub,
      username: claims.username,
      issuedAt: claims.iat,
      email: claims.email,
      emailVerified: claims.emailVerified,
    };
  } catch {
    return null;
  }
}

function gatewayAuthorizerIdentity(
  event: APIGatewayProxyEventV2,
): { kind: 'absent' } | { kind: 'invalid' } | { kind: 'valid'; identity: AuthenticatedIdentity } {
  const context = event.requestContext as { authorizer?: unknown };
  if (context.authorizer === undefined) return { kind: 'absent' };
  if (!isRecord(context.authorizer) || !isRecord(context.authorizer.jwt))
    return { kind: 'invalid' };
  const claims = context.authorizer.jwt.claims;
  if (!isRecord(claims) || claims.token_use !== 'id') return { kind: 'invalid' };
  const sub = claims[CognitoClaim.subject];
  const username = claims[CognitoClaim.username] ?? claims.username;
  const issuedAt = epochSeconds(claims.iat);
  return typeof sub === 'string' && typeof username === 'string'
    ? {
        kind: 'valid',
        identity: {
          sub,
          username,
          issuedAt,
          ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
          emailVerified: claims.email_verified === true || claims.email_verified === 'true',
        },
      }
    : { kind: 'invalid' };
}

function epochSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  return undefined;
}

function bearerToken(headers: Record<string, string | undefined>): string | null {
  const value = headers[AuthHeader.authorization] ?? headers[AuthHeader.authorizationLegacy];
  const match = value && /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1] ?? null;
}

function getVerifier(): TokenVerifier {
  if (cachedVerifier) return cachedVerifier;
  const userPoolId = process.env[EnvironmentVariable.cognitoUserPoolId];
  const clientId = process.env[EnvironmentVariable.cognitoClientId];
  if (!userPoolId || !clientId) throw new Error('Authentication is not configured.');
  cachedVerifier = createCognitoVerifier({
    userPoolId,
    clientId,
    localEndpoint: process.env[EnvironmentVariable.cognitoLocalEndpoint],
  });
  return cachedVerifier;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
