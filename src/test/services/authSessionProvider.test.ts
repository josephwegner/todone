import { afterEach, expect, it, vi } from 'vitest';
import { createAuthSessionProvider } from '../../session/authSessionProvider';
import { SESSION_PROVIDER_TIMEOUT_MS } from '../../session/timing';
import type { AuthClient } from '../../services/authClient';

afterEach(() => vi.useRealTimers());
it('bounds a hanging provider and returns only a safe transient outcome', async () => {
  vi.useFakeTimers();
  const client = { restoreSession: vi.fn(() => new Promise(() => {})) } as unknown as AuthClient;
  const result = createAuthSessionProvider(client).restore();
  await vi.advanceTimersByTimeAsync(SESSION_PROVIDER_TIMEOUT_MS);
  expect(await result).toEqual({ kind: 'error', failure: 'provider-unavailable' });
});
