import { describe, expect, it, vi } from 'vitest';
import { fetchMyProfile, saveMyProfile } from '../../services/profileClient';

describe('profile API client', () => {
  it('reads the self-only route with a bearer token and no-store cache policy', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ profile: null }),
    });

    await expect(fetchMyProfile('private-token', fetchMock)).resolves.toEqual({
      kind: 'success',
      data: { profile: null, allowedActions: [] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/profiles/me',
      expect.objectContaining({
        cache: 'no-store',
        method: 'GET',
        headers: expect.objectContaining({ authorization: 'Bearer private-token' }),
      }),
    );
  });

  it('sends only versioned profile fields and maps a lost session', async () => {
    const saveFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        profile: { memberId: 'member', displayName: 'River', color: 'LAKE', version: 1 },
      }),
    });
    await saveMyProfile('token', { displayName: 'River', color: 'LAKE', version: 0 }, saveFetch);
    const init = saveFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      displayName: 'River',
      color: 'LAKE',
      version: 0,
    });

    const unauthorizedFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    await expect(fetchMyProfile('token', unauthorizedFetch)).resolves.toMatchObject({
      kind: 'error',
      recoverable: false,
      message: 'Your session ended. Sign in to continue.',
    });
  });
});
