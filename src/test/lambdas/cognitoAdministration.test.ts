import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  AdminUserGlobalSignOutCommand,
  type CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AwsCognitoAdministration,
  CognitoAdministrationError,
  CognitoAdministrationFailure,
  CognitoAdministrationOperation,
  type CognitoAdministration,
  type CreateCognitoUserInput,
  type CreatedCognitoUser,
} from '../../../lambdas/cognito/administration';

class FakeClient {
  readonly commands: unknown[] = [];
  responses: unknown[] = [];

  async send(command: unknown): Promise<unknown> {
    this.commands.push(command);
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return response ?? {};
  }
}

function adapter(client: FakeClient): AwsCognitoAdministration {
  return new AwsCognitoAdministration(
    'pool-one',
    client as unknown as CognitoIdentityProviderClient,
  );
}

describe('Cognito administration adapter', () => {
  it('creates a child without delivery and returns only the stable sub', async () => {
    const client = new FakeClient();
    client.responses.push({ User: { Attributes: [{ Name: 'sub', Value: 'sub-one' }] } });

    await expect(
      adapter(client).createUser({ kind: 'child', username: 'child-one' }),
    ).resolves.toEqual({
      sub: 'sub-one',
    });
    const command = client.commands[0];
    expect(command).toBeInstanceOf(AdminCreateUserCommand);
    expect((command as AdminCreateUserCommand).input).toEqual({
      UserPoolId: 'pool-one',
      Username: 'child-one',
      MessageAction: 'SUPPRESS',
    });
  });

  it('creates a pending parent with unverified email and built-in email delivery', async () => {
    const client = new FakeClient();
    client.responses.push({ User: { Attributes: [{ Name: 'sub', Value: 'sub-parent' }] } });

    await adapter(client).createUser({
      kind: 'pending-parent',
      username: 'parent-two',
      email: 'parent@example.test',
    });

    expect((client.commands[0] as AdminCreateUserCommand).input).toEqual({
      UserPoolId: 'pool-one',
      Username: 'parent-two',
      DesiredDeliveryMediums: ['EMAIL'],
      UserAttributes: [
        { Name: 'email', Value: 'parent@example.test' },
        { Name: 'email_verified', Value: 'false' },
      ],
    });
  });

  it('uses the reviewed Cognito commands for all lifecycle operations', async () => {
    const client = new FakeClient();
    const administration = adapter(client);
    const transientPassword = `A1!a${randomUUID()}`;

    await administration.resendWelcome('parent-two');
    await administration.updatePendingParentEmail('parent-two', 'replacement@example.test');
    await administration.setPermanentPassword('child-one', transientPassword);
    await administration.globalSignOut('child-one');
    await administration.deleteUser('child-one');

    expect(client.commands.map((command) => command.constructor)).toEqual([
      AdminCreateUserCommand,
      AdminUpdateUserAttributesCommand,
      AdminSetUserPasswordCommand,
      AdminUserGlobalSignOutCommand,
      AdminDeleteUserCommand,
    ]);
    for (const command of client.commands) {
      expect((command as { input: { UserPoolId?: string } }).input.UserPoolId).toBe('pool-one');
    }
    expect((client.commands[0] as AdminCreateUserCommand).input.MessageAction).toBe('RESEND');
    expect((client.commands[1] as AdminUpdateUserAttributesCommand).input.UserAttributes).toEqual([
      { Name: 'email', Value: 'replacement@example.test' },
      { Name: 'email_verified', Value: 'false' },
    ]);
    expect(client.commands).not.toContainEqual(
      expect.objectContaining({
        input: expect.objectContaining({
          UserAttributes: expect.arrayContaining([{ Name: 'email_verified', Value: 'true' }]),
        }),
      }),
    );
    expect((client.commands[2] as AdminSetUserPasswordCommand).input).toEqual({
      UserPoolId: 'pool-one',
      Username: 'child-one',
      Password: transientPassword,
      Permanent: true,
    });
  });

  it.each([
    ['UsernameExistsException', CognitoAdministrationFailure.usernameConflict],
    ['AliasExistsException', CognitoAdministrationFailure.identityConflict],
    ['UserNotFoundException', CognitoAdministrationFailure.userNotFound],
    ['InvalidPasswordException', CognitoAdministrationFailure.invalidPassword],
    ['InvalidParameterException', CognitoAdministrationFailure.invalidState],
    ['TooManyRequestsException', CognitoAdministrationFailure.throttled],
    ['InternalErrorException', CognitoAdministrationFailure.unavailable],
    ['UnrecognizedDependencyFailure', CognitoAdministrationFailure.unknown],
  ])('maps %s to the safe %s domain failure', async (name, kind) => {
    const client = new FakeClient();
    const dependencyError = new Error('private@example.test raw AWS detail');
    dependencyError.name = name;
    client.responses.push(dependencyError);
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const result = await adapter(client)
      .deleteUser('private-user')
      .catch((error: unknown) => error);

    expect(result).toMatchObject({
      name: 'CognitoAdministrationError',
      kind,
      operation: CognitoAdministrationOperation.deleteUser,
    });
    expect(result).not.toHaveProperty('cause');
    expect(result).not.toHaveProperty('$metadata');
    expect((result as Error).message).not.toContain('private@example.test');
    expect((result as Error).message).not.toContain('AWS');
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('can be replaced by a deterministic fake through the typed boundary', async () => {
    const calls: CreateCognitoUserInput[] = [];
    const fake: CognitoAdministration = {
      async createUser(input): Promise<CreatedCognitoUser> {
        calls.push(input);
        return { sub: 'fixed-sub' };
      },
      async canResendWelcome() {
        return true;
      },
      async resendWelcome() {},
      async updatePendingParentEmail() {},
      async stageRecoveryEmail() {},
      async setPermanentPassword() {},
      async deleteUser() {},
      async globalSignOut() {},
    };

    await expect(fake.createUser({ kind: 'child', username: 'child-one' })).resolves.toEqual({
      sub: 'fixed-sub',
    });
    expect(calls).toEqual([{ kind: 'child', username: 'child-one' }]);
  });

  it('fails safely if Cognito omits the stable sub from a create response', async () => {
    const client = new FakeClient();
    client.responses.push({ User: { Attributes: [] } });

    await expect(
      adapter(client).createUser({ kind: 'child', username: 'child-one' }),
    ).rejects.toEqual(
      new CognitoAdministrationError(
        CognitoAdministrationFailure.unknown,
        CognitoAdministrationOperation.createUser,
      ),
    );
  });
});
it('stages a recovery email without changing email_verified in either direction', async () => {
  const client = new FakeClient();
  await adapter(client).stageRecoveryEmail('stable-sub', 'replacement@example.test');
  expect((client.commands[0] as AdminUpdateUserAttributesCommand).input.UserAttributes).toEqual([
    { Name: 'email', Value: 'replacement@example.test' },
  ]);
});

it.each([
  ['FORCE_CHANGE_PASSWORD', true, true],
  ['CONFIRMED', true, false],
  ['FORCE_CHANGE_PASSWORD', false, false],
  ['RESET_REQUIRED', true, false],
] as const)(
  'checks private invitation eligibility for %s enabled=%s',
  async (UserStatus, Enabled, eligible) => {
    const client = new FakeClient();
    client.responses.push({
      UserStatus,
      Enabled,
      UserAttributes: [{ Name: 'email', Value: 'private@example.test' }],
    });
    expect(await adapter(client).canResendWelcome('immutable-sub')).toBe(eligible);
    expect(client.commands[0]).toBeInstanceOf(AdminGetUserCommand);
    expect((client.commands[0] as AdminGetUserCommand).input).toEqual({
      UserPoolId: 'pool-one',
      Username: 'immutable-sub',
    });
  },
);
it('does not infer invitation eligibility from missing provider state', async () => {
  const client = new FakeClient();
  await expect(adapter(client).canResendWelcome('immutable-sub')).rejects.toMatchObject({
    kind: 'unknown',
    operation: 'can-resend-welcome',
  });
});
