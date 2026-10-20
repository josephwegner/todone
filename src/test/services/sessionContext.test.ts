import { describe, expect, it, vi } from 'vitest';
import { readSessionContext } from '../../session/sessionContext';

const credentials = {
  idToken: 'synthetic-token',
  accessToken: 'synthetic-access',
  expiresAt: new Date('2030-01-01'),
};

describe('session context boundary', () => {
  it.each([
    [403, 'MEMBERSHIP_PENDING_ACTIVATION', 'pending-activation'],
    [403, 'MEMBERSHIP_INACTIVE', 'inactive'],
    [500, 'MEMBERSHIP_INCONSISTENT', 'inconsistent'],
    [401, 'SESSION_REAUTHENTICATION_REQUIRED', 'credentials-stale'],
    [503, 'INTERNAL_ERROR', 'context-unavailable'],
  ])('preserves %s %s and never reads a profile after denial', async (status, code, failure) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: { code } }), { status }));
    const abort = new AbortController();
    expect(await readSessionContext(credentials, abort.signal, fetchMock)).toEqual({
      kind: 'error',
      failure,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: abort.signal, cache: 'no-store' });
  });

  it('resolves only successful null membership as unattached', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ membership: null })));
    expect(await readSessionContext(credentials, new AbortController().signal, fetchMock)).toEqual({
      kind: 'success',
      context: { kind: 'unattached' },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
