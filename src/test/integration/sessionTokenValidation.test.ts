import { generateKeyPairSync, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCognitoVerifier } from '../../../lambdas/session/verifier';
import { handler } from '../../../lambdas/session';
import { simulateLambda } from '../../../local-dev/lambdaSimulator';

// Only JWKS transport is substituted: actual RSA signatures and verifier policy run unchanged.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'http://localhost:9229/local_security';
const audience = 'security-test-client';
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'security-test',
  alg: 'RS256',
  use: 'sig',
};
function token(overrides: Record<string, unknown> = {}, invalidSignature = false) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = {
    iss: issuer,
    aud: audience,
    sub: 'private-sub-canary',
    'cognito:username': 'private-username-canary',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
  const unsigned = `${encode({ alg: 'RS256', kid: jwk.kid })}.${encode(payload)}`;
  const signature = sign('RSA-SHA256', Buffer.from(unsigned), privateKey);
  if (invalidSignature) signature[0] = signature[0]! ^ 1;
  return `${unsigned}.${signature.toString('base64url')}`;
}
afterEach(() => vi.unstubAllGlobals());

describe('actual token validation through the local API boundary', () => {
  it.each([
    ['valid', {}, false, 200],
    ['wrong issuer', { iss: 'https://wrong.invalid/pool' }, false, 401],
    ['wrong audience', { aud: 'another-client' }, false, 401],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 60 }, false, 401],
    ['invalid signature', {}, true, 401],
  ] as const)(
    '%s token obeys authentication and disclosure policy',
    async (_name, overrides, invalid, status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })),
      );
      const verifier = createCognitoVerifier({
        localEndpoint: 'http://localhost:9229',
        userPoolId: 'local_security',
        clientId: audience,
      });
      const app = express();
      app.get('/api/v1/session', async (req, res) => {
        await simulateLambda((event) => handler(event, verifier), req, res);
      });
      const response = await request(app)
        .get('/api/v1/session')
        .set('Authorization', `Bearer ${token(overrides, invalid)}`);
      expect(response.status).toBe(status);
      expect(response.headers['cache-control']).toBe('no-store');
      if (status === 401) {
        expect(response.body).toEqual({ error: 'unauthorized' });
        expect(JSON.stringify(response.body)).not.toMatch(
          /private-|wrong.invalid|another-client|signature|expired/,
        );
      } else {
        expect(response.body.username).toBe('private-username-canary');
      }
    },
  );
});
