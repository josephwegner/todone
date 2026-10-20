import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionController,
  type SessionContextResult,
} from '../../session/sessionController';
import { AuthStorageUnavailableError } from '../../services/authSessionErrors';
import { fetchAuthenticatedJson } from '../../services/apiClient';
import { SessionOperationCancelledError } from '../../session/sessionErrors';

function fixture() {
  let marker = 'browser-one';
  const readContext = vi.fn(async (): Promise<SessionContextResult> => ({
    kind: 'success',
    context: { kind: 'unattached' },
  }));
  const restore = vi.fn(async () => ({
    kind: 'usable' as const,
    browserGeneration: marker,
    credentials: {
      idToken: `token-${marker}`,
      accessToken: 'synthetic-access',
      expiresAt: new Date('2030-01-01'),
    },
  }));
  const clearPrivateState = vi.fn();
  const session = createSessionController({
    provider: { restore, signIn: vi.fn(), signOut: vi.fn() },
    readContext,
    clearPrivateState,
    readBrowserGeneration: () => marker,
  });
  return {
    session,
    restore,
    readContext,
    clearPrivateState,
    replace: () => {
      marker = 'browser-two';
    },
  };
}
afterEach(() => vi.restoreAllMocks());
describe('browser generation reconciliation', () => {
  it('coalesces duplicate/reordered hints by rereading the current marker', async () => {
    const { session, restore, readContext, replace, clearPrivateState } = fixture();
    await session.initialize();
    replace();
    await Promise.all([
      session.reconcileBrowserAccount(),
      session.reconcileBrowserAccount(),
      session.reconcileBrowserAccount(),
    ]);
    await session.reconcileBrowserAccount();
    expect(restore).toHaveBeenCalledTimes(2);
    expect(readContext).toHaveBeenCalledTimes(2);
    expect(clearPrivateState).toHaveBeenCalledOnce();
    expect(session.state.value.kind).toBe('ready');
    session.dispose();
  });
  it('discards pending old-account success and clears private state before adopting the current account', async () => {
    const { session, replace, clearPrivateState } = fixture();
    await session.initialize();
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const request = fetchAuthenticatedJson(
      '/api/v1/example',
      session.requestContext(),
      { method: 'GET' },
      fetchMock,
    );
    const rejected = expect(request).rejects.toBeInstanceOf(SessionOperationCancelledError);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    replace();
    finish(new Response('{"oldPrivateData":"canary"}'));
    await rejected;
    await session.initialize();
    expect(clearPrivateState).toHaveBeenCalledOnce();
    expect(session.state.value.kind).toBe('ready');
    session.dispose();
  });
  it('clears private presentation when shared storage becomes unavailable', async () => {
    let denied = false;
    const session = createSessionController({
      provider: {
        restore: async () => ({ kind: 'signed-out', browserGeneration: 'browser-one' }),
        signIn: vi.fn(),
        signOut: vi.fn(),
      },
      readContext: vi.fn(),
      readBrowserGeneration: () => {
        if (denied) throw new AuthStorageUnavailableError();
        return 'browser-one';
      },
    });
    await session.initialize();
    denied = true;
    await session.reconcileBrowserAccount();
    expect(session.state.value).toEqual({
      kind: 'recoverable-error',
      failure: 'storage-unavailable',
    });
    session.dispose();
  });
});
