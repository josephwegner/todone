export const AUTH_STORAGE_VERSION = 1;
export const AuthStorageKind = { signedIn: 'signed-in', signedOut: 'signed-out' } as const;
export const AuthChangeKind = { changed: 'changed', signedOut: 'signed-out' } as const;
export const AUTH_GENERATION_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
export const authStoragePrefix = (clientId: string) =>
  `todone.auth.v${AUTH_STORAGE_VERSION}.${encodeURIComponent(clientId)}.`;
export const authMarkerKey = (clientId: string) => `${authStoragePrefix(clientId)}current`;
export const authPublicationLock = (clientId: string) =>
  `${authStoragePrefix(clientId)}publication`;
export const authChangeChannel = (clientId: string) => `${authStoragePrefix(clientId)}changes`;
export const sdkAuthPrefix = (clientId: string) => `CognitoIdentityServiceProvider.${clientId}.`;
export const localCredentialKey = (clientId: string) => `todone.auth.${clientId}.localSession`;
