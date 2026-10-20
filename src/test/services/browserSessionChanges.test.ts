import { afterEach, expect, it, vi } from 'vitest';
import { observeBrowserSessionChanges } from '../../session/browserSessionChanges';
import { authMarkerKey } from '../../session/authStorageContract';

afterEach(() => vi.unstubAllGlobals());
it('sends only opaque hints and ignores messages that attempt to supply credentials or grants', async () => {
  const messages: unknown[] = [];
  let receive!: (event: MessageEvent) => void;
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      set onmessage(handler: (event: MessageEvent) => void) {
        receive = handler;
      }
      postMessage(value: unknown) {
        messages.push(value);
      }
      close() {}
    },
  );
  const reconcile = vi.fn(async () => {});
  const observer = observeBrowserSessionChanges('client', reconcile);
  observer.announce({ version: 1, kind: 'signed-in', generation: 'opaque-generation' });
  expect(messages).toEqual([{ kind: 'changed', generation: 'opaque-generation' }]);
  receive(
    new MessageEvent('message', {
      data: { kind: 'changed', generation: 'forged', token: 'credential-canary', role: 'parent' },
    }),
  );
  expect(reconcile).not.toHaveBeenCalled();
  receive(
    new MessageEvent('message', { data: { kind: 'changed', generation: 'untrusted-generation' } }),
  );
  expect(reconcile).toHaveBeenCalledOnce();
  observer.close();
});
it('uses storage events when BroadcastChannel is unavailable and removes its listener on disposal', async () => {
  vi.stubGlobal('BroadcastChannel', undefined);
  const reconcile = vi.fn(async () => {});
  const observer = observeBrowserSessionChanges('client', reconcile);
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'unrelated', newValue: 'private-value' }),
  );
  expect(reconcile).not.toHaveBeenCalled();
  window.dispatchEvent(
    new StorageEvent('storage', { key: authMarkerKey('client'), newValue: 'untrusted-metadata' }),
  );
  expect(reconcile).toHaveBeenCalledOnce();
  observer.close();
  window.dispatchEvent(new StorageEvent('storage', { key: authMarkerKey('client') }));
  expect(reconcile).toHaveBeenCalledOnce();
});
