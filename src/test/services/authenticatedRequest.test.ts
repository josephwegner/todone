import { describe, expect, it, vi } from 'vitest';
import { fetchAuthenticatedJson, type AuthenticatedRequestSession } from '../../services/apiClient';
import { SessionOperationCancelledError } from '../../session/sessionErrors';

function fixture() {
  const scope = {
    credentials: vi.fn(async (force?: boolean) => (force ? 'new-id' : 'old-id')),
    isCurrent: vi.fn(() => true),
    signal: new AbortController().signal,
    onResponse: vi.fn(async () => {}),
  } satisfies AuthenticatedRequestSession;
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: 'ok' })));
  return { scope, fetchMock };
}
describe('authenticated request lifecycle', () => {
  it('acquires credentials at send time and renews/retries a rejected safe read once', async () => {
    const { scope, fetchMock } = fixture();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 }),
    );
    await fetchAuthenticatedJson('/api/v1/example', scope, { method: 'GET' }, fetchMock);
    expect(scope.credentials.mock.calls).toEqual([[false], [true]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      cache: 'no-store',
      signal: scope.signal,
      headers: { authorization: 'Bearer new-id' },
    });
  });
  it('stops after a second authentication rejection', async () => {
    const { scope, fetchMock } = fixture();
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }));
    await fetchAuthenticatedJson('/api/v1/example', scope, { method: 'GET' }, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(scope.onResponse).toHaveBeenCalledOnce();
  });
  it.each(['POST', 'PUT'])(
    'does not replay a sent %s or change its idempotency key',
    async (method) => {
      const { scope, fetchMock } = fixture();
      fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
      await fetchAuthenticatedJson(
        '/api/v1/example',
        scope,
        { method, headers: { 'idempotency-key': 'original-key' }, body: '{"example":true}' },
        fetchMock,
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(scope.credentials.mock.calls).toEqual([[false]]);
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
        headers: { 'idempotency-key': 'original-key' },
        body: '{"example":true}',
      });
    },
  );
  it('does not renew/retry credential-cutoff rejection', async () => {
    const { scope, fetchMock } = fixture();
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'SESSION_REAUTHENTICATION_REQUIRED' } }), {
        status: 401,
      }),
    );
    await fetchAuthenticatedJson('/api/v1/example', scope, { method: 'GET' }, fetchMock);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(scope.credentials.mock.calls).toEqual([[false]]);
  });
  it('does not send when credential renewal is unavailable', async () => {
    const { scope, fetchMock } = fixture();
    scope.credentials.mockRejectedValue(new Error('bounded internal failure'));
    await expect(
      fetchAuthenticatedJson('/api/v1/example', scope, { method: 'PUT' }, fetchMock),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('discards late successful reads and mutations after identity invalidation', async () => {
    for (const method of ['GET', 'PUT']) {
      const { scope, fetchMock } = fixture();
      let finish!: (value: Response) => void;
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const pending = fetchAuthenticatedJson('/api/v1/example', scope, { method }, fetchMock);
      const rejected = expect(pending).rejects.toBeInstanceOf(SessionOperationCancelledError);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      scope.isCurrent.mockReturnValue(false);
      finish(new Response('{"private":"old-result"}'));
      await rejected;
      expect(scope.onResponse).not.toHaveBeenCalled();
    }
  });
  it('rejects an already invalidated request before acquiring another account’s credentials', async () => {
    const { scope, fetchMock } = fixture();
    scope.isCurrent.mockReturnValue(false);
    await expect(
      fetchAuthenticatedJson('/api/v1/example', scope, {}, fetchMock),
    ).rejects.toBeInstanceOf(SessionOperationCancelledError);
    expect(scope.credentials).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it('blocks an expired-token write while real controller renewal is unavailable', async () => {
  const { createSessionController } = await import('../../session/sessionController');
  const session = createSessionController({
    provider: {
      restore: async () => ({
        kind: 'usable',
        credentials: {
          idToken: 'known-expired',
          accessToken: 'known-expired-access',
          expiresAt: new Date(Date.now() - 1000),
        },
      }),
      renew: async () => ({ kind: 'error', failure: 'provider-unavailable' }),
      signIn: vi.fn(),
      signOut: vi.fn(),
    },
    readContext: async () => ({ kind: 'success', context: { kind: 'unattached' } }),
  });
  await session.initialize();
  const fetchMock = vi.fn();
  await expect(
    fetchAuthenticatedJson(
      '/api/v1/example',
      session.requestContext(),
      { method: 'PUT' },
      fetchMock,
    ),
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
  session.dispose();
});
