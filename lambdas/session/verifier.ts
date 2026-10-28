import { CognitoJwtVerifier, JwtVerifier } from 'aws-jwt-verify';

export interface SessionClaims {
  sub: string;
  username: string;
  /** Issued-at time as seconds since epoch, matching the JWT `iat` claim. */
  iat?: number;
  email?: string;
  emailVerified?: boolean;
  /** Expiration as seconds since epoch, matching the JWT `exp` claim. */
  exp: number;
}

export interface TokenVerifier {
  verify(token: string): Promise<SessionClaims>;
}

interface CognitoVerifierConfig {
  userPoolId: string;
  clientId: string;
  /**
   * LOCAL DEVELOPMENT ONLY. When set, verifies tokens issued by cognito-local
   * (see scripts/setup-local-cognito.ts) instead of real Cognito. Never set
   * this against a deployed pool; real Cognito's issuer/JWKS are always used
   * when it is absent.
   */
  localEndpoint?: string;
}

const INVALID_ID_TOKEN_KIND = 'Verified token is not an ID token.';
function toSessionClaims(payload: Record<string, unknown>): SessionClaims {
  if (payload.token_use !== 'id') throw new Error(INVALID_ID_TOKEN_KIND);
  const { sub, exp, iat } = payload;
  const username = payload['cognito:username'] ?? payload['username'];

  if (typeof username !== 'string') {
    throw new Error('Verified token is missing a username claim.');
  }
  if (typeof sub !== 'string' || typeof exp !== 'number') {
    throw new Error('Verified token is missing a required claim.');
  }

  if (iat !== undefined && typeof iat !== 'number') {
    throw new Error('Verified token has an invalid issued-at claim.');
  }
  return {
    sub,
    username,
    ...(iat === undefined ? {} : { iat }),
    exp,
    ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    ...(payload.email_verified === true ? { emailVerified: true } : {}),
  };
}

/**
 * Builds a verifier against the real Cognito ID-token issuer/audience, or
 * (local development only) against cognito-local's issuer/JWKS. This is the
 * only file that talks to a network JWKS endpoint; everything downstream can
 * be tested with a fake TokenVerifier.
 */
export function createCognitoVerifier(config: CognitoVerifierConfig): TokenVerifier {
  if (config.localEndpoint) {
    return createLocalVerifier(config.localEndpoint, config.userPoolId, config.clientId);
  }

  const verifier = CognitoJwtVerifier.create({
    userPoolId: config.userPoolId,
    tokenUse: 'id',
    clientId: config.clientId,
  });

  return {
    async verify(token: string): Promise<SessionClaims> {
      const payload = await verifier.verify(token);
      return toSessionClaims(payload as unknown as Record<string, unknown>);
    },
  };
}

/**
 * LOCAL DEVELOPMENT ONLY. aws-jwt-verify's built-in JWKS fetcher hardcodes
 * Node's `https` module and rejects plain `http://` URLs -- which
 * cognito-local always serves on. We work around this by fetching the JWKS
 * ourselves (plain `fetch`, no such restriction) and priming the verifier's
 * cache via `cacheJwks`, so its internal fetcher is never exercised.
 */
function createLocalVerifier(
  localEndpoint: string,
  userPoolId: string,
  clientId: string,
): TokenVerifier {
  const issuer = `${localEndpoint}/${userPoolId}`;
  const jwksUri = `${issuer}/.well-known/jwks.json`;
  const verifier = JwtVerifier.create({ issuer, jwksUri, audience: clientId });

  let jwksLoaded = false;
  async function ensureJwksLoaded(): Promise<void> {
    if (jwksLoaded) {
      return;
    }
    const response = await fetch(jwksUri);
    if (!response.ok) {
      throw new Error(`Failed to fetch local JWKS from ${jwksUri}`);
    }
    verifier.cacheJwks(await response.json());
    jwksLoaded = true;
  }

  return {
    async verify(token: string): Promise<SessionClaims> {
      await ensureJwksLoaded();
      const payload = await verifier.verify(token);
      return toSessionClaims(payload as unknown as Record<string, unknown>);
    },
  };
}
