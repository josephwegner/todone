import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthClient } from '../../services/authClient';
import { createMemoryAuthStorage } from '../../session/authStorage';
import {
  CognitoIdentityProviderClient,
  GetUserAttributeVerificationCodeCommand,
  VerifyUserAttributeCommand,
} from '@aws-sdk/client-cognito-identity-provider';
const config = {
  userPoolId: 'us-east-1_test',
  clientId: 'client',
  registrationClientId: 'registration',
  region: 'us-east-1',
};
const issuedAt = Math.floor(Date.now() / 1000);
function token(emailVerified = false) {
  return `header.${btoa(JSON.stringify({ sub: 'pending', username: 'pending', email: 'parent@example.test', email_verified: emailVerified, iat: issuedAt, exp: issuedAt + 3600 }))}.signature`;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});
describe('parent setup with the real Cognito user/storage adapter', () => {
  it('completes the real NEW_PASSWORD_REQUIRED exchange without storing setup secrets, then renews tokens in the supplied scope', async () => {
    const scope = createMemoryAuthStorage();
    const code = 'SyntheticSetup1!',
      password = 'SyntheticChosen1!';
    const requests: Array<{ target: string; input: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, options: RequestInit) => {
        const target =
          (options.headers as Record<string, string>)['X-Amz-Target'] ??
          (options.headers as Record<string, string>)['x-amz-target'];
        const input = JSON.parse(options.body as string);
        requests.push({ target, input });
        let result: unknown;
        if (target.endsWith('InitiateAuth') && input.AuthFlow !== 'REFRESH_TOKEN_AUTH')
          result = {
            ChallengeName: 'PASSWORD_VERIFIER',
            Session: 'first',
            ChallengeParameters: {
              USER_ID_FOR_SRP: 'pending',
              SRP_B: '2',
              SALT: 'ab',
              SECRET_BLOCK: btoa('synthetic'),
            },
          };
        else if (
          target.endsWith('RespondToAuthChallenge') &&
          input.ChallengeName === 'PASSWORD_VERIFIER'
        )
          result = {
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            Session: 'second',
            ChallengeParameters: {
              userAttributes: JSON.stringify({ email: 'parent@example.test' }),
              requiredAttributes: '[]',
            },
          };
        else
          result = {
            AuthenticationResult: {
              IdToken: token(input.AuthFlow === 'REFRESH_TOKEN_AUTH'),
              AccessToken: token(),
              RefreshToken: 'synthetic-refresh',
              ExpiresIn: 3600,
            },
          };
        return new Response(JSON.stringify(result), { status: 200 });
      }),
    );
    const client = new AuthClient(config, scope);
    expect((await client.signIn('pending', code, password)).kind).toBe('success');
    const challenge = requests.find((r) => r.input.ChallengeName === 'NEW_PASSWORD_REQUIRED')!;
    expect(challenge.input).toMatchObject({
      Session: 'second',
      ChallengeResponses: { USERNAME: 'pending', NEW_PASSWORD: password },
    });
    expect(Object.keys(challenge.input.ChallengeResponses as object)).toEqual([
      'NEW_PASSWORD',
      'USERNAME',
    ]);
    const values = Array.from({ length: scope.length }, (_, i) => [
      scope.key(i),
      scope.getItem(scope.key(i)!),
    ]);
    expect(JSON.stringify(values)).not.toContain(code);
    expect(JSON.stringify(values)).not.toContain(password);
    expect(localStorage.length).toBe(0);
    await client.renewSession();
    expect(requests.at(-1)!.input).toMatchObject({ AuthFlow: 'REFRESH_TOKEN_AUTH' });
    expect(client.getIdToken()).toBe(token(true));
  });
  it('uses the supplied access token for native verification and never administratively marks an email verified', async () => {
    const send = vi
      .spyOn(CognitoIdentityProviderClient.prototype, 'send')
      .mockResolvedValue({} as never);
    const client = new AuthClient(config, createMemoryAuthStorage());
    expect(await client.verifyEmailAttribute('current-access')).toEqual({ kind: 'success' });
    expect(await client.verifyEmailAttribute('current-access', 'synthetic-code')).toEqual({
      kind: 'success',
    });
    expect(send.mock.calls[0]![0]).toBeInstanceOf(GetUserAttributeVerificationCodeCommand);
    expect(send.mock.calls[1]![0]).toBeInstanceOf(VerifyUserAttributeCommand);
    expect(send.mock.calls[1]![0].input).toEqual({
      AccessToken: 'current-access',
      AttributeName: 'email',
      Code: 'synthetic-code',
    });
    expect(localStorage.length).toBe(0);
  });
  it('explicitly refuses unsupported local verification without fabricating ownership', async () => {
    const send = vi.spyOn(CognitoIdentityProviderClient.prototype, 'send');
    const client = new AuthClient(
      { ...config, localEndpoint: 'http://localhost:9229' },
      createMemoryAuthStorage(),
    );
    expect(await client.verifyEmailAttribute('current-access', 'code')).toMatchObject({
      kind: 'error',
      recoverable: false,
    });
    expect(send).not.toHaveBeenCalled();
  });
});

import { createBrowserSessionProvider } from '../../session/browserSessionProvider';
import { createAuthStorage } from '../../session/authStorage';
it('late real SDK challenge writes cannot publish credentials after shared sign-out', async () => {
  const shared = createMemoryAuthStorage();
  let nonce = 0;
  const storage = createAuthStorage(config.clientId, {
    shared: () => shared,
    legacy: createMemoryAuthStorage,
    exclusive: async (work) => work(),
    nonce: () => `generation-${++nonce}`,
  });
  const browser = createBrowserSessionProvider(
    config,
    storage,
    (scope) => new AuthClient(config, scope),
  );
  let finish!: () => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, options: RequestInit) => {
      const target = (options.headers as Record<string, string>)['X-Amz-Target'],
        input = JSON.parse(options.body as string);
      let result: unknown;
      if (target.endsWith('InitiateAuth'))
        result = {
          ChallengeName: 'PASSWORD_VERIFIER',
          Session: 'first',
          ChallengeParameters: {
            USER_ID_FOR_SRP: 'pending',
            SRP_B: '2',
            SALT: 'ab',
            SECRET_BLOCK: btoa('synthetic'),
          },
        };
      else if (input.ChallengeName === 'PASSWORD_VERIFIER')
        result = {
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: 'second',
          ChallengeParameters: { userAttributes: '{}', requiredAttributes: '[]' },
        };
      else {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        result = {
          AuthenticationResult: {
            IdToken: token(),
            AccessToken: token(),
            RefreshToken: 'synthetic-refresh',
          },
        };
      }
      return new Response(JSON.stringify(result), { status: 200 });
    }),
  );
  const signIn = browser.provider.signIn('pending', 'SyntheticSetup1!', 'SyntheticChosen1!');
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  await browser.provider.signOut('explicit');
  finish();
  expect(await signIn).toEqual({ kind: 'cancelled' });
  expect((await browser.provider.restore()).kind).toBe('signed-out');
  const stored = JSON.stringify(
    Array.from({ length: shared.length }, (_, i) => shared.getItem(shared.key(i)!)),
  );
  expect(stored).not.toContain('synthetic-refresh');
  expect(stored).not.toContain('SyntheticChosen');
  expect(localStorage.length).toBe(0);
});
