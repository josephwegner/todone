import { describe, expect, it, vi } from 'vitest';
import { createHousehold, fetchCurrentMembership } from '../../services/householdClient';

describe('household API client', () => {
  it.each([
    [403, 'MEMBERSHIP_PENDING_ACTIVATION', 'pending-activation'],
    [403, 'MEMBERSHIP_INACTIVE', 'inactive'],
    [500, 'MEMBERSHIP_INCONSISTENT', 'inconsistent'],
    [401, 'SESSION_REAUTHENTICATION_REQUIRED', 'credentials-stale'],
  ])(
    'preserves the caller outcome for %s %s without calling it unattached',
    async (status, code, failure) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status,
        json: async () => ({ error: { code } }),
      });
      expect(await fetchCurrentMembership('token', fetchMock)).toMatchObject({
        kind: 'error',
        failure,
      });
    },
  );

  it.each([
    [503, 'INTERNAL_ERROR'],
    [500, 'MEMBERSHIP_INACTIVE'],
    [403, 'UNKNOWN_CODE'],
  ])('does not guess a membership state for %s %s', async (status, code) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status, json: async () => ({ error: { code } }) });
    const result = await fetchCurrentMembership('token', fetchMock);
    expect(result).toMatchObject({ kind: 'error', recoverable: true });
    expect(result).not.toHaveProperty('failure');
  });
  it('uses a bearer header and no-store for current membership', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ membership: null }),
    });
    await expect(fetchCurrentMembership('private-token', fetchMock)).resolves.toEqual({
      kind: 'success',
      data: { membership: null },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/memberships/current',
      expect.objectContaining({
        cache: 'no-store',
        headers: expect.objectContaining({ authorization: 'Bearer private-token' }),
      }),
    );
  });

  it('sends only name/timezone plus the idempotency header', async () => {
    const membership = {
      memberId: 'member',
      role: 'parent',
      household: {
        householdId: 'house',
        name: 'River',
        timezone: 'America/Chicago',
      },
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ membership }),
    });
    await createHousehold(
      'token',
      { name: 'River', timezone: 'America/Chicago', idempotencyKey: 'request-key' },
      fetchMock,
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'River',
      timezone: 'America/Chicago',
    });
    expect(init.headers).toMatchObject({ 'idempotency-key': 'request-key' });
  });

  it('preserves safe field errors and maps session loss', async () => {
    const validationFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          message: 'Check fields.',
          fieldErrors: [{ field: 'name', message: 'Required.' }],
        },
      }),
    });
    const result = await createHousehold(
      'token',
      { name: '', timezone: 'America/Chicago', idempotencyKey: 'key' },
      validationFetch,
    );
    expect(result).toMatchObject({
      kind: 'error',
      fieldErrors: [{ field: 'name', message: 'Required.' }],
    });

    const unauthorizedFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    await expect(fetchCurrentMembership('token', unauthorizedFetch)).resolves.toMatchObject({
      kind: 'error',
      recoverable: false,
      message: 'Your session ended. Sign in to continue.',
    });
  });
});
