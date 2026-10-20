import {
  AUTH_GENERATION_PATTERN,
  AuthChangeKind,
  authChangeChannel,
  authMarkerKey,
} from './authStorageContract';
import type { AuthMarker } from './authStorage';

/** Messages are hints only; authoritative credentials/context are never supplied by events. */
export function observeBrowserSessionChanges(clientId: string, reconcile: () => Promise<void>) {
  let channel: BroadcastChannel | null = null;
  let closed = false;
  function requestReconciliation() {
    if (!closed)
      void reconcile().catch(() => {
        /* Controller owns safe storage/recovery state. */
      });
  }
  function onStorage(event: StorageEvent) {
    if (event.key === authMarkerKey(clientId) || event.key === null) requestReconciliation();
  }
  globalThis.window.addEventListener('storage', onStorage);
  try {
    if (typeof globalThis.BroadcastChannel === 'function') {
      channel = new globalThis.BroadcastChannel(authChangeChannel(clientId));
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const value = event.data;
        if (
          !value ||
          typeof value !== 'object' ||
          Object.keys(value).sort().join(',') !== 'generation,kind' ||
          !('kind' in value) ||
          (value.kind !== AuthChangeKind.changed && value.kind !== AuthChangeKind.signedOut) ||
          !('generation' in value) ||
          typeof value.generation !== 'string' ||
          !AUTH_GENERATION_PATTERN.test(value.generation)
        )
          return;
        requestReconciliation();
      };
    }
  } catch {
    channel = null;
  }
  return {
    announce(marker: AuthMarker) {
      try {
        channel?.postMessage({
          kind: marker.kind === 'signed-out' ? AuthChangeKind.signedOut : AuthChangeKind.changed,
          generation: marker.generation,
        });
      } catch {
        /* A storage event and foreground reconciliation remain available. */
      }
    },
    close() {
      closed = true;
      globalThis.window.removeEventListener('storage', onStorage);
      channel?.close();
    },
  };
}
