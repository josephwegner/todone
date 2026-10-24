import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  CreateUserPoolCommand,
  ListUserPoolClientsCommand,
  ListUserPoolsCommand,
  UpdateUserPoolCommand,
  type CreateUserPoolClientCommandInput,
} from '@aws-sdk/client-cognito-identity-provider';

import { LocalDevelopment, requireLocalCognitoEndpoint } from './configuration';
import { join } from 'node:path';
const POOL_NAME = 'todone-local';
const PWA_CLIENT_NAME = 'todone-local-pwa';
const REGISTRATION_CLIENT_NAME = 'todone-local-registration';
export const DEFAULT_USERNAME = 'localdev';
// Disposable local fixture only; never used against AWS.
export const DEFAULT_PASSWORD = 'LocalDevPass123!';

export async function setupLocalCognito(
  rootDirectory: string,
  account: { username: string; password: string } | null = {
    username: DEFAULT_USERNAME,
    password: DEFAULT_PASSWORD,
  },
) {
  const endpoint = requireLocalCognitoEndpoint(process.env);
  const client = createLocalCognitoClient(endpoint);
  try {
    const userPoolId = await getOrCreateUserPool(client);
    await enableLocalEmailVerification(client, userPoolId);
    const clientId = await getOrCreateAppClient(client, userPoolId, PWA_CLIENT_NAME, [
      'ALLOW_USER_PASSWORD_AUTH',
      'ALLOW_REFRESH_TOKEN_AUTH',
    ]);
    const registrationClientId = await getOrCreateAppClient(
      client,
      userPoolId,
      REGISTRATION_CLIENT_NAME,
      ['ALLOW_CUSTOM_AUTH'],
    );
    if (account) await upsertLocalAccount(client, userPoolId, account.username, account.password);
    writeLocalEnv(join(rootDirectory, '.env.local'), {
      userPoolId,
      clientId,
      registrationClientId,
    });
    return { client, userPoolId, clientId, registrationClientId };
  } catch (error) {
    client.destroy();
    throw error;
  }
}

/** Fixed dummy credentials and a validated loopback endpoint prohibit default AWS credential discovery. */
export function createLocalCognitoClient(endpoint: string = LocalDevelopment.cognitoEndpoint) {
  requireLocalCognitoEndpoint({ COGNITO_LOCAL_ENDPOINT: endpoint });
  return new CognitoIdentityProviderClient({
    region: 'local',
    endpoint,
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 1000, requestTimeout: 5000 },
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
}

async function getOrCreateUserPool(client: CognitoIdentityProviderClient): Promise<string> {
  const existing = await client.send(new ListUserPoolsCommand({ MaxResults: 60 }));
  const found = existing.UserPools?.find((pool) => pool.Name === POOL_NAME);
  if (found?.Id) {
    return found.Id;
  }

  const created = await client.send(
    new CreateUserPoolCommand({
      PoolName: POOL_NAME,
      // Mirrors the replacement production pool: plain, case-insensitive,
      // immutable usernames (ADR 0002); no email/phone requirement.
      UsernameConfiguration: { CaseSensitive: false },
      // Cognito Local writes verification codes for these attributes to its
      // console. Without this, SignUp creates an unconfirmed user but has no
      // delivery channel and therefore no code to enter in the local UI.
      AutoVerifiedAttributes: ['email'],
      Policies: {
        PasswordPolicy: {
          MinimumLength: 8,
          RequireUppercase: true,
          RequireLowercase: true,
          RequireNumbers: true,
          RequireSymbols: true,
        },
      },
    }),
  );

  if (!created.UserPool?.Id) {
    throw new Error('cognito-local did not return a user pool ID.');
  }
  return created.UserPool.Id;
}

/** Applies email-code delivery to a pool created by an earlier setup run. */
async function enableLocalEmailVerification(
  client: CognitoIdentityProviderClient,
  userPoolId: string,
): Promise<void> {
  await client.send(
    new UpdateUserPoolCommand({
      UserPoolId: userPoolId,
      AutoVerifiedAttributes: ['email'],
    }),
  );
}

async function getOrCreateAppClient(
  client: CognitoIdentityProviderClient,
  userPoolId: string,
  clientName: string,
  explicitAuthFlows: NonNullable<CreateUserPoolClientCommandInput['ExplicitAuthFlows']>,
): Promise<string> {
  const existing = await client.send(
    new ListUserPoolClientsCommand({ UserPoolId: userPoolId, MaxResults: 60 }),
  );
  const found = existing.UserPoolClients?.find((c) => c.ClientName === clientName);
  if (found?.ClientId) {
    return found.ClientId;
  }

  const created = await client.send(
    new CreateUserPoolClientCommand({
      UserPoolId: userPoolId,
      ClientName: clientName,
      // Public client: no secret, matching the real PWA app client.
      GenerateSecret: false,
      ExplicitAuthFlows: explicitAuthFlows,
    }),
  );

  if (!created.UserPoolClient?.ClientId) {
    throw new Error('cognito-local did not return an app client ID.');
  }
  return created.UserPoolClient.ClientId;
}

export async function upsertLocalAccount(
  client: CognitoIdentityProviderClient,
  userPoolId: string,
  username: string,
  password: string,
  email?: string,
): Promise<string> {
  try {
    await client.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        MessageAction: 'SUPPRESS',
        ...(email
          ? {
              UserAttributes: [
                { Name: 'email', Value: email },
                { Name: 'email_verified', Value: 'true' },
              ],
            }
          : {}),
      }),
    );
  } catch (error) {
    // Idempotent: if the account already exists, just (re)set its password.
    if (!isUsernameExists(error)) {
      throw error;
    }
  }

  await client.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: userPoolId,
      Username: username,
      Password: password,
      Permanent: true,
    }),
  );
  const current = await client.send(
    new AdminGetUserCommand({ UserPoolId: userPoolId, Username: username }),
  );
  const sub = current.UserAttributes?.find((attribute) => attribute.Name === 'sub')?.Value;
  if (!sub) throw new Error('Local identity did not supply its stable subject.');
  return sub;
}

function isUsernameExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'UsernameExistsException'
  );
}

function writeLocalEnv(
  envPath: string,
  values: {
    userPoolId: string;
    clientId: string;
    registrationClientId: string;
  },
): void {
  const lines = existsSync(envPath)
    ? readFileSync(envPath, 'utf-8').split('\n').filter(Boolean)
    : [];

  const updates: Record<string, string> = {
    VITE_COGNITO_USER_POOL_ID: values.userPoolId,
    VITE_COGNITO_CLIENT_ID: values.clientId,
    VITE_COGNITO_REGISTRATION_CLIENT_ID: values.registrationClientId,
    VITE_COGNITO_REGION: 'local',
    VITE_COGNITO_LOCAL_ENDPOINT: LocalDevelopment.cognitoEndpoint,
    COGNITO_USER_POOL_ID: values.userPoolId,
    COGNITO_CLIENT_ID: values.clientId,
    COGNITO_LOCAL_ENDPOINT: LocalDevelopment.cognitoEndpoint,
    TODONE_LOCAL_DEVELOPMENT: 'true',
  };

  const seen = new Set<string>();
  const merged = lines.map((line) => {
    const [key] = line.split('=');
    if (key && key in updates) {
      seen.add(key);
      return `${key}=${updates[key]}`;
    }
    return line;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      merged.push(`${key}=${value}`);
    }
  }

  writeFileSync(envPath, `${merged.join('\n')}\n`, 'utf-8');
}
