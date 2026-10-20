import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionController,
  type SessionContextResult,
} from '../../session/sessionController';
import { fetchAuthenticatedJson } from '../../services/apiClient';
import { SESSION_CONTEXT_FRESHNESS_MS } from '../../session/timing';

const membership = {
  memberId: 'member',
  username: 'parent',
  role: 'parent' as const,
  household: { householdId: 'house', name: 'Home', timezone: 'America/Chicago' },
};
const profile = { memberId: 'member', displayName: 'River', color: 'PINE' as const, version: 1 };
const context = { kind: 'active' as const, membership, profile };
function fixture() {
  const credentials = {
    idToken: 'test-id',
    accessToken: 'test-access',
    expiresAt: new Date(Date.now() + 3_600_000),
  };
  const readContext = vi.fn(async (): Promise<SessionContextResult> => ({
    kind: 'success',
    context,
  }));
  const signOut = vi.fn();
  const session = createSessionController({
    provider: { restore: async () => ({ kind: 'usable', credentials }), signIn: vi.fn(), signOut },
    readContext,
  });
  return { session, readContext, signOut };
}
describe('context freshness and authoritative denials', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it('refreshes foreground context on five-minute freshness, never repeated initialize', async () => {
    const { session, readContext } = fixture();
    await session.initialize();
    await session.initialize();
    expect(readContext).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(SESSION_CONTEXT_FRESHNESS_MS);
    expect(readContext).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it('coalesces stale foreground return and simultaneous refresh calls', async () => {
    const { session, readContext } = fixture();
    await session.initialize();
    vi.setSystemTime(Date.now() + SESSION_CONTEXT_FRESHNESS_MS);
    const calls = [session.reconcile(), session.refreshContext(true), session.refreshContext(true)];
    await Promise.all(calls);
    expect(readContext).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it('retains confirmed content on transient failure and exposes retry guidance', async () => {
    const { session, readContext } = fixture();
    await session.initialize();
    const previous = session.state.value;
    readContext.mockResolvedValue({ kind: 'error', failure: 'context-unavailable' });
    await session.refreshContext(true);
    expect(session.state.value).toBe(previous);
    expect(session.backgroundFailure.value).toBe('context-unavailable');
    session.dispose();
  });
  it.each(['pending-activation', 'inactive', 'inconsistent', 'credentials-stale'] as const)(
    'removes private presentation after authoritative %s',
    async (failure) => {
      const { session, readContext } = fixture();
      await session.initialize();
      readContext.mockResolvedValue({ kind: 'error', failure });
      await session.refreshContext(true);
      expect(session.state.value.kind).not.toBe('ready');
      expect(session.state.value).not.toHaveProperty('context');
      session.dispose();
    },
  );
  it('ends a previously attached identity that becomes unattached', async () => {
    const { session, readContext } = fixture();
    await session.initialize();
    readContext.mockResolvedValue({ kind: 'success', context: { kind: 'unattached' } });
    await session.refreshContext(true);
    expect(session.state.value).toEqual({ kind: 'signed-out', reason: 'ended' });
    session.dispose();
  });
  it('keeps a valid account after target denial, and revalidates generic access denial', async () => {
    const { session, readContext, signOut } = fixture();
    await session.initialize();
    for (const code of ['TARGET_NOT_MANAGEABLE', 'MEMBER_ACCESS_UNAVAILABLE']) {
      await fetchAuthenticatedJson(
        '/api/v1/example',
        session.requestContext(),
        { method: 'PUT' },
        vi.fn(async () => new Response(JSON.stringify({ error: { code } }), { status: 403 })),
      );
      expect(session.state.value.kind).toBe('ready');
      expect(signOut).not.toHaveBeenCalled();
    }
    expect(readContext).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it('does not overwrite confirmed profile updates with an older pending refresh', async () => {
    const { session, readContext } = fixture();
    await session.initialize();
    let finish!: (result: SessionContextResult) => void;
    readContext.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const refreshing = session.refreshContext(true);
    await Promise.resolve();
    await Promise.resolve();
    session.applyConfirmedProfile({ ...profile, displayName: 'New name', version: 2 });
    finish({ kind: 'success', context });
    await refreshing;
    expect(session.state.value).toMatchObject({
      kind: 'ready',
      context: { profile: { displayName: 'New name', version: 2 } },
    });
    session.dispose();
  });
});
