import { AuthStorageUnavailableError } from '../services/authSessionErrors';
import {
  AUTH_GENERATION_PATTERN,
  AUTH_STORAGE_VERSION,
  AuthStorageKind,
  authMarkerKey,
  authPublicationLock,
  authStoragePrefix,
  localCredentialKey,
  sdkAuthPrefix,
} from './authStorageContract';

export interface AuthMarker {
  version: typeof AUTH_STORAGE_VERSION;
  kind: 'signed-in' | 'signed-out';
  generation: string;
}
export interface AuthStorageDependencies {
  shared(): Storage;
  legacy(): Storage;
  exclusive<T>(work: () => T | Promise<T>): Promise<T>;
  nonce(): string;
}
export interface AuthStorageBinding {
  generation: string;
  baseGeneration: string;
  storage: Storage;
  close(): void;
}

/** Public account flows may retain SDK metadata only in this nonpersistent scope. */
export function createMemoryAuthStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  };
}

/** Native locks serialize only short publication/cleanup sections, never provider waits. */
export function browserAuthStorageDependencies(clientId: string): AuthStorageDependencies {
  return {
    shared: () => globalThis.localStorage,
    legacy: () => globalThis.sessionStorage,
    nonce: () => globalThis.crypto.randomUUID(),
    async exclusive(work) {
      if (!globalThis.navigator.locks) throw new AuthStorageUnavailableError();
      try {
        return await globalThis.navigator.locks.request(authPublicationLock(clientId), work);
      } catch {
        throw new AuthStorageUnavailableError();
      }
    },
  };
}

/** SDK writes are bound to one immutable scope. Only the marker publishes an account. */
export function createAuthStorage(
  clientId: string,
  dependencies = browserAuthStorageDependencies(clientId),
) {
  const prefix = authStoragePrefix(clientId);
  const markerKey = authMarkerKey(clientId);
  const credentialsPrefix = `${prefix}credentials.`;
  const pendingPrefix = `${prefix}pending.`;
  const probeKey = `${prefix}probe`;
  let announce: ((marker: AuthMarker) => void) | undefined;
  function access<T>(operation: () => T): T {
    try {
      return operation();
    } catch {
      throw new AuthStorageUnavailableError();
    }
  }
  function keys(storage: Storage): string[] {
    return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
      (key): key is string => key !== null,
    );
  }
  function nonce() {
    const value = dependencies.nonce();
    if (!AUTH_GENERATION_PATTERN.test(value)) throw new AuthStorageUnavailableError();
    return value;
  }
  function readMarker(): AuthMarker | null {
    return access(() => {
      const stored = dependencies.shared().getItem(markerKey);
      if (stored === null) return null;
      const parsed: unknown = JSON.parse(stored);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        Object.keys(parsed).sort().join(',') !== 'generation,kind,version' ||
        !('version' in parsed) ||
        parsed.version !== AUTH_STORAGE_VERSION ||
        !('kind' in parsed) ||
        (parsed.kind !== AuthStorageKind.signedIn && parsed.kind !== AuthStorageKind.signedOut) ||
        !('generation' in parsed) ||
        typeof parsed.generation !== 'string' ||
        !AUTH_GENERATION_PATTERN.test(parsed.generation)
      )
        throw new AuthStorageUnavailableError();
      return parsed as AuthMarker;
    });
  }
  function writeMarker(marker: AuthMarker) {
    dependencies.shared().setItem(markerKey, JSON.stringify(marker));
    try {
      announce?.(marker);
    } catch {
      /* Native storage events still request reconciliation. */
    }
  }
  function cleanup(marker: AuthMarker) {
    const storage = dependencies.shared();
    const active = `${credentialsPrefix}${marker.generation}.`;
    const validPending = `${pendingPrefix}${marker.generation}.`;
    for (const key of keys(storage)) {
      if (
        (key.startsWith(credentialsPrefix) &&
          (marker.kind === AuthStorageKind.signedOut || !key.startsWith(active))) ||
        (key.startsWith(pendingPrefix) && !key.startsWith(validPending))
      )
        storage.removeItem(key);
    }
  }
  function clearLegacy(): boolean {
    const legacy = dependencies.legacy();
    let removed = false;
    for (const key of keys(legacy)) {
      if (key.startsWith(sdkAuthPrefix(clientId)) || key === localCredentialKey(clientId)) {
        legacy.removeItem(key);
        removed = true;
      }
    }
    return removed;
  }
  async function initialize(): Promise<{ marker: AuthMarker; migratedLegacy: boolean }> {
    return dependencies.exclusive(() =>
      access(() => {
        const storage = dependencies.shared();
        storage.setItem(probeKey, '1');
        storage.removeItem(probeKey);
        const legacy = clearLegacy();
        let marker = readMarker();
        const migratedLegacy = marker === null && legacy;
        if (!marker) {
          marker = {
            version: AUTH_STORAGE_VERSION,
            kind: AuthStorageKind.signedOut,
            generation: nonce(),
          };
          writeMarker(marker);
        }
        cleanup(marker);
        return { marker, migratedLegacy };
      }),
    );
  }
  function allowedKey(key: string): boolean {
    if (key === localCredentialKey(clientId)) return true;
    if (!key.startsWith(sdkAuthPrefix(clientId))) return false;
    const sdkKey = key.slice(sdkAuthPrefix(clientId).length);
    if (sdkKey === 'LastAuthUser') return true;
    // Deliberately exclude the SDK userData cache: it can contain recovery contact/attributes.
    return /.+\.(idToken|accessToken|refreshToken|clockDrift|deviceKey|randomPasswordKey|deviceGroupKey)$/.test(
      sdkKey,
    );
  }
  function binding(
    generation: string,
    baseGeneration: string,
    staging: boolean,
  ): AuthStorageBinding {
    let open = true;
    const namespace = staging
      ? `${pendingPrefix}${baseGeneration}.${generation}.`
      : `${credentialsPrefix}${generation}.`;
    const physicalKey = (key: string) => `${namespace}${encodeURIComponent(key)}`;
    const ownedKeys = () => keys(dependencies.shared()).filter((key) => key.startsWith(namespace));
    const current = () => {
      if (!open) return false;
      const marker = readMarker();
      if (!marker) return false;
      if (staging) return marker.generation === baseGeneration;
      return marker.kind === AuthStorageKind.signedIn && marker.generation === generation;
    };
    const storage: Storage = {
      get length() {
        return access(() => ownedKeys().length);
      },
      key: (index) =>
        access(() => {
          const key = ownedKeys()[index];
          return key ? decodeURIComponent(key.slice(namespace.length)) : null;
        }),
      getItem: (key) =>
        access(() =>
          current() && allowedKey(key) ? dependencies.shared().getItem(physicalKey(key)) : null,
        ),
      setItem: (key, value) =>
        access(() => {
          if (current() && allowedKey(key)) dependencies.shared().setItem(physicalKey(key), value);
        }),
      removeItem: (key) =>
        access(() => {
          dependencies.shared().removeItem(physicalKey(key));
        }),
      clear: () =>
        access(() => {
          for (const key of ownedKeys()) dependencies.shared().removeItem(key);
        }),
    };
    return {
      generation,
      baseGeneration,
      storage,
      close: () => {
        open = false;
      },
    };
  }
  async function restoreBinding() {
    const { marker, migratedLegacy } = await initialize();
    return {
      marker,
      migratedLegacy,
      binding:
        marker.kind === AuthStorageKind.signedIn
          ? binding(marker.generation, marker.generation, false)
          : null,
    };
  }
  async function beginSignIn(): Promise<AuthStorageBinding> {
    const { marker } = await initialize();
    return binding(nonce(), marker.generation, true);
  }
  async function publish(stage: AuthStorageBinding): Promise<AuthMarker | null> {
    return dependencies.exclusive(() =>
      access(() => {
        const current = readMarker();
        if (!current || current.generation !== stage.baseGeneration) {
          stage.storage.clear();
          stage.close();
          return null;
        }
        const namespace = `${credentialsPrefix}${stage.generation}.`;
        const storage = dependencies.shared();
        const stageKeys = Array.from({ length: stage.storage.length }, (_, index) =>
          stage.storage.key(index),
        ).filter((key): key is string => key !== null);
        if (stageKeys.length === 0) throw new AuthStorageUnavailableError();
        try {
          for (const key of stageKeys) {
            const value = stage.storage.getItem(key);
            if (value !== null) storage.setItem(`${namespace}${encodeURIComponent(key)}`, value);
          }
          const marker: AuthMarker = {
            version: AUTH_STORAGE_VERSION,
            kind: AuthStorageKind.signedIn,
            generation: stage.generation,
          };
          writeMarker(marker);
          stage.storage.clear();
          stage.close();
          cleanup(marker);
          return marker;
        } catch {
          for (const key of keys(storage)) if (key.startsWith(namespace)) storage.removeItem(key);
          throw new AuthStorageUnavailableError();
        }
      }),
    );
  }
  async function signOut(expectedGeneration?: string): Promise<AuthMarker> {
    return dependencies.exclusive(() =>
      access(() => {
        if (expectedGeneration) {
          const current = readMarker();
          if (current && current.generation !== expectedGeneration) return current;
        }
        const marker: AuthMarker = {
          version: AUTH_STORAGE_VERSION,
          kind: AuthStorageKind.signedOut,
          generation: nonce(),
        };
        // Publish before cleanup. Even a subsequent cleanup failure cannot make old writes current.
        writeMarker(marker);
        cleanup(marker);
        clearLegacy();
        return marker;
      }),
    );
  }
  return {
    markerKey,
    readMarker,
    initialize,
    restoreBinding,
    beginSignIn,
    publish,
    signOut,
    setAnnouncement: (listener: (marker: AuthMarker) => void) => {
      announce = listener;
    },
  };
}
export type AuthStorage = ReturnType<typeof createAuthStorage>;
