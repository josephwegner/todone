import { beforeEach, describe, expect, it, vi } from 'vitest';

const verifyMock = vi.fn();
const localVerifyMock = vi.fn();
const cacheJwksMock = vi.fn();
const jwtVerifierCreateMock = vi.fn(() => ({ verify: localVerifyMock, cacheJwks: cacheJwksMock }));

vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({ verify: verifyMock }),
  },
  JwtVerifier: {
    create: jwtVerifierCreateMock,
  },
}));

const { createCognitoVerifier } = await import('../../../lambdas/session/verifier');

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('createCognitoVerifier', () => {
  beforeEach(() => {
    verifyMock.mockReset();
    localVerifyMock.mockReset();
    cacheJwksMock.mockReset();
    jwtVerifierCreateMock.mockClear();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ keys: [] }) });
  });

  it('maps a verified payload to sub, username, and exp', async () => {
    verifyMock.mockResolvedValue({
      token_use: 'id',
      sub: 'sub-123',
      'cognito:username': 'parent1',
      exp: 1_700_000_000,
    });

    const verifier = createCognitoVerifier({ userPoolId: 'pool-id', clientId: 'client-id' });
    const claims = await verifier.verify('a-jwt');

    expect(claims).toEqual({ sub: 'sub-123', username: 'parent1', exp: 1_700_000_000 });
  });

  it('rejects a verified payload with no username claim rather than returning an empty username', async () => {
    verifyMock.mockResolvedValue({ token_use: 'id', sub: 'sub-123', exp: 1_700_000_000 });

    const verifier = createCognitoVerifier({ userPoolId: 'pool-id', clientId: 'client-id' });

    await expect(verifier.verify('a-jwt')).rejects.toThrow(/username/i);
  });

  it('propagates verification failures (expired, wrong issuer, malformed) without mapping them', async () => {
    verifyMock.mockRejectedValue(new Error('JwtExpiredError'));

    const verifier = createCognitoVerifier({ userPoolId: 'pool-id', clientId: 'client-id' });

    await expect(verifier.verify('a-jwt')).rejects.toThrow('JwtExpiredError');
  });

  it('LOCAL DEVELOPMENT ONLY: uses a generic JwtVerifier against the cognito-local issuer/JWKS when localEndpoint is set', async () => {
    localVerifyMock.mockResolvedValue({
      token_use: 'id',
      sub: 'sub-456',
      'cognito:username': 'localdev',
      exp: 1_800_000_000,
    });

    const verifier = createCognitoVerifier({
      userPoolId: 'local_abc123',
      clientId: 'local-client-id',
      localEndpoint: 'http://localhost:9229',
    });
    const claims = await verifier.verify('a-local-jwt');

    expect(jwtVerifierCreateMock).toHaveBeenCalledWith({
      issuer: 'http://localhost:9229/local_abc123',
      jwksUri: 'http://localhost:9229/local_abc123/.well-known/jwks.json',
      audience: 'local-client-id',
    });
    // aws-jwt-verify's built-in fetcher rejects plain http:// URLs, so we
    // fetch the JWKS ourselves and prime the cache instead of letting it
    // fetch internally.
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:9229/local_abc123/.well-known/jwks.json',
    );
    expect(cacheJwksMock).toHaveBeenCalledWith({ keys: [] });
    expect(claims).toEqual({ sub: 'sub-456', username: 'localdev', exp: 1_800_000_000 });
    // The real-Cognito verifier is never constructed/called in local mode.
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('LOCAL DEVELOPMENT ONLY: only fetches the JWKS once across multiple verify calls', async () => {
    localVerifyMock.mockResolvedValue({
      token_use: 'id',
      sub: 'sub-456',
      'cognito:username': 'localdev',
      exp: 1_800_000_000,
    });

    const verifier = createCognitoVerifier({
      userPoolId: 'local_abc123',
      clientId: 'local-client-id',
      localEndpoint: 'http://localhost:9229',
    });
    await verifier.verify('a-local-jwt');
    await verifier.verify('another-local-jwt');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localVerifyMock).toHaveBeenCalledTimes(2);
  });

  it('does not use the local verifier when localEndpoint is absent', async () => {
    verifyMock.mockResolvedValue({
      token_use: 'id',
      sub: 'sub-123',
      'cognito:username': 'parent1',
      exp: 1_700_000_000,
    });

    const verifier = createCognitoVerifier({ userPoolId: 'pool-id', clientId: 'client-id' });
    await verifier.verify('a-jwt');

    expect(jwtVerifierCreateMock).not.toHaveBeenCalled();
  });
});
