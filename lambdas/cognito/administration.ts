import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  UserStatusType,
} from '@aws-sdk/client-cognito-identity-provider';
import { messages } from '../shared/messages';

export const CognitoAdministrationOperation = {
  createUser: 'create-user',
  resendWelcome: 'resend-welcome',
  canResendWelcome: 'can-resend-welcome',
  updatePendingParentEmail: 'update-pending-parent-email',
  stageRecoveryEmail: 'stage-recovery-email',
  setPermanentPassword: 'set-permanent-password',
  deleteUser: 'delete-user',
  globalSignOut: 'global-sign-out',
} as const;

export const CognitoAdministrationFailure = {
  usernameConflict: 'username-conflict',
  identityConflict: 'identity-conflict',
  userNotFound: 'user-not-found',
  invalidPassword: 'invalid-password',
  invalidState: 'invalid-state',
  throttled: 'throttled',
  unavailable: 'unavailable',
  unknown: 'unknown',
} as const;

export const CognitoUserKind = {
  child: 'child',
  pendingParent: 'pending-parent',
} as const;

const CognitoAttribute = {
  sub: 'sub',
  email: 'email',
  emailVerified: 'email_verified',
} as const;

const CognitoMessageAction = {
  suppress: 'SUPPRESS',
  resend: 'RESEND',
} as const;

type CognitoAdministrationOperationValue =
  (typeof CognitoAdministrationOperation)[keyof typeof CognitoAdministrationOperation];
export type CognitoAdministrationFailureValue =
  (typeof CognitoAdministrationFailure)[keyof typeof CognitoAdministrationFailure];

const SAFE_FAILURE_MESSAGES: Record<CognitoAdministrationFailureValue, string> = {
  [CognitoAdministrationFailure.usernameConflict]: messages.cognitoAdministration.usernameConflict,
  [CognitoAdministrationFailure.identityConflict]: messages.cognitoAdministration.identityConflict,
  [CognitoAdministrationFailure.userNotFound]: messages.cognitoAdministration.userNotFound,
  [CognitoAdministrationFailure.invalidPassword]: messages.cognitoAdministration.invalidPassword,
  [CognitoAdministrationFailure.invalidState]: messages.cognitoAdministration.invalidState,
  [CognitoAdministrationFailure.throttled]: messages.cognitoAdministration.throttled,
  [CognitoAdministrationFailure.unavailable]: messages.cognitoAdministration.unavailable,
  [CognitoAdministrationFailure.unknown]: messages.cognitoAdministration.unknown,
};

/** Safe dependency error. It deliberately retains no AWS message, metadata, or private input. */
export class CognitoAdministrationError extends Error {
  readonly name = 'CognitoAdministrationError';

  constructor(
    readonly kind: CognitoAdministrationFailureValue,
    readonly operation: CognitoAdministrationOperationValue,
  ) {
    super(SAFE_FAILURE_MESSAGES[kind]);
  }
}

export type CreateCognitoUserInput =
  | { kind: (typeof CognitoUserKind)['child']; username: string }
  | { kind: (typeof CognitoUserKind)['pendingParent']; username: string; email: string };

export interface CreatedCognitoUser {
  /** Stable Cognito identity used for Membership ownership; never expose it to clients or logs. */
  sub: string;
}

/**
 * Privileged identity boundary. Route handlers must complete application authorization before
 * invoking it; the adapter intentionally accepts no caller, household, role, or target authority.
 */
export interface CognitoAdministration {
  createUser(input: CreateCognitoUserInput): Promise<CreatedCognitoUser>;
  canResendWelcome(sub: string): Promise<boolean>;
  resendWelcome(username: string): Promise<void>;
  updatePendingParentEmail(username: string, email: string): Promise<void>;
  stageRecoveryEmail(username: string, email: string): Promise<void>;
  setPermanentPassword(username: string, password: string): Promise<void>;
  deleteUser(username: string): Promise<void>;
  globalSignOut(username: string): Promise<void>;
}

export class AwsCognitoAdministration implements CognitoAdministration {
  constructor(
    private readonly userPoolId: string,
    private readonly client = new CognitoIdentityProviderClient({}),
  ) {}

  async createUser(input: CreateCognitoUserInput): Promise<CreatedCognitoUser> {
    const operation = CognitoAdministrationOperation.createUser;
    try {
      let command: AdminCreateUserCommand;
      if (input.kind === CognitoUserKind.child) {
        command = new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: input.username,
          MessageAction: CognitoMessageAction.suppress,
        });
      } else {
        command = new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: input.username,
          DesiredDeliveryMediums: ['EMAIL'],
          UserAttributes: [
            { Name: CognitoAttribute.email, Value: input.email },
            { Name: CognitoAttribute.emailVerified, Value: String(false) },
          ],
        });
      }
      const response = await this.client.send(command);
      const sub = response.User?.Attributes?.find(
        (attribute) => attribute.Name === CognitoAttribute.sub,
      )?.Value;
      if (!sub)
        throw new CognitoAdministrationError(CognitoAdministrationFailure.unknown, operation);
      return { sub };
    } catch (error) {
      throw safeAdministrationError(error, operation);
    }
  }

  /** Cognito invitation credentials apply only before the NEW_PASSWORD_REQUIRED transition. */
  async canResendWelcome(sub: string): Promise<boolean> {
    const operation = CognitoAdministrationOperation.canResendWelcome;
    try {
      const response = await this.client.send(
        new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: sub }),
      );
      if (!response.UserStatus || response.Enabled === undefined)
        throw new CognitoAdministrationError(CognitoAdministrationFailure.unknown, operation);
      return response.Enabled && response.UserStatus === UserStatusType.FORCE_CHANGE_PASSWORD;
    } catch (error) {
      throw safeAdministrationError(error, operation);
    }
  }

  async resendWelcome(username: string): Promise<void> {
    const operation = CognitoAdministrationOperation.resendWelcome;
    try {
      await this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          MessageAction: CognitoMessageAction.resend,
          DesiredDeliveryMediums: ['EMAIL'],
        }),
      );
    } catch (error) {
      throw safeAdministrationError(error, operation);
    }
  }

  async updatePendingParentEmail(username: string, email: string): Promise<void> {
    await this.updateAttributes(
      username,
      [
        { Name: CognitoAttribute.email, Value: email },
        { Name: CognitoAttribute.emailVerified, Value: String(false) },
      ],
      CognitoAdministrationOperation.updatePendingParentEmail,
    );
  }

  /** Cognito retains the existing verified email until native attribute verification promotes its replacement. */
  async stageRecoveryEmail(username: string, email: string): Promise<void> {
    await this.updateAttributes(
      username,
      [{ Name: CognitoAttribute.email, Value: email }],
      CognitoAdministrationOperation.stageRecoveryEmail,
    );
  }

  async setPermanentPassword(username: string, password: string): Promise<void> {
    const operation = CognitoAdministrationOperation.setPermanentPassword;
    try {
      await this.client.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          Password: password,
          Permanent: true,
        }),
      );
    } catch (error) {
      throw safeAdministrationError(error, operation);
    }
  }

  async deleteUser(username: string): Promise<void> {
    const operation = CognitoAdministrationOperation.deleteUser;
    try {
      await this.client.send(
        new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: username }),
      );
    } catch (error) {
      throw safeAdministrationError(error, operation);
    }
  }

  async globalSignOut(username: string): Promise<void> {
    const operation = CognitoAdministrationOperation.globalSignOut;
    try {
      await this.client.send(
        new AdminUserGlobalSignOutCommand({ UserPoolId: this.userPoolId, Username: username }),
      );
    } catch (error) {
      throw safeAdministrationError(error, operation);
    }
  }

  private async updateAttributes(
    username: string,
    attributes: Array<{ Name: string; Value: string }>,
    operation: CognitoAdministrationOperationValue,
  ): Promise<void> {
    try {
      await this.client.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: this.userPoolId,
          Username: username,
          UserAttributes: attributes,
        }),
      );
    } catch (error) {
      throw safeAdministrationError(error, operation);
    }
  }
}

function safeAdministrationError(
  error: unknown,
  operation: CognitoAdministrationOperationValue,
): CognitoAdministrationError {
  if (error instanceof CognitoAdministrationError) return error;
  const dependencyName = dependencyErrorName(error);
  return new CognitoAdministrationError(failureKind(dependencyName), operation);
}

function failureKind(dependencyName: string | undefined): CognitoAdministrationFailureValue {
  switch (dependencyName) {
    case 'UsernameExistsException':
      return CognitoAdministrationFailure.usernameConflict;
    case 'AliasExistsException':
      return CognitoAdministrationFailure.identityConflict;
    case 'UserNotFoundException':
      return CognitoAdministrationFailure.userNotFound;
    case 'InvalidPasswordException':
      return CognitoAdministrationFailure.invalidPassword;
    case 'NotAuthorizedException':
    case 'UnsupportedUserStateException':
    case 'InvalidParameterException':
      return CognitoAdministrationFailure.invalidState;
    case 'TooManyRequestsException':
    case 'LimitExceededException':
      return CognitoAdministrationFailure.throttled;
    case 'InternalErrorException':
    case 'ServiceUnavailableException':
    case 'TimeoutError':
      return CognitoAdministrationFailure.unavailable;
    default:
      return CognitoAdministrationFailure.unknown;
  }
}

function dependencyErrorName(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('name' in error)) return undefined;
  return typeof error.name === 'string' ? error.name : undefined;
}
