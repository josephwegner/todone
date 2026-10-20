import { describe, expect, it, vi } from 'vitest';
import { safeSessionDiagnostic } from '../../session/diagnostics';
import { createSessionController } from '../../session/sessionController';

describe('session diagnostic privacy', () => {
  it('constructs only allowlisted coarse fields even when an input contains private extras', () => {
    const input = {
      operation: 'startup' as const,
      outcome: 'success' as const,
      durationMs: 1.6,
      token: 'token-canary',
      username: 'username-canary',
      profile: 'profile-canary',
      message: 'raw-sdk-canary',
    };
    expect(safeSessionDiagnostic(input)).toEqual({
      operation: 'startup',
      outcome: 'success',
      durationMs: 2,
    });
  });
  it('reports completed and failed operations without credentials, identity, or raw provider messages', async () => {
    const diagnostics = vi.fn();
    const session = createSessionController({
      diagnostics,
      provider: {
        restore: async () => ({
          kind: 'usable',
          credentials: {
            idToken: 'id-token-canary',
            accessToken: 'access-token-canary',
            expiresAt: new Date('2030-01-01'),
          },
        }),
        renew: vi.fn(async () => {
          throw new Error('raw-sdk-canary household-canary username-canary');
        }),
        signIn: vi.fn(),
        signOut: vi.fn(),
      },
      readContext: async () => ({ kind: 'success', context: { kind: 'unattached' } }),
    });
    await session.initialize();
    await session.ensureUsableCredentials(true).catch(() => {});
    session.signOut();
    expect(diagnostics.mock.calls.map(([event]) => event.operation)).toEqual([
      'startup',
      'renewal',
      'invalidation',
    ]);
    expect(diagnostics.mock.calls.map(([event]) => event.outcome)).toEqual([
      'success',
      'recoverable-failure',
      'signed-out',
    ]);
    const output = JSON.stringify(diagnostics.mock.calls);
    for (const forbidden of [
      'id-token-canary',
      'access-token-canary',
      'raw-sdk-canary',
      'household-canary',
      'username-canary',
    ])
      expect(output).not.toContain(forbidden);
    for (const [event] of diagnostics.mock.calls)
      expect(Object.keys(event).sort()).toEqual(['durationMs', 'operation', 'outcome']);
    session.dispose();
  });
  it('does not let a failing diagnostic sink prevent sign-out', async () => {
    const session = createSessionController({
      diagnostics: () => {
        throw new Error('diagnostic-sink-failure');
      },
      provider: {
        restore: async () => ({ kind: 'signed-out' }),
        signIn: vi.fn(),
        signOut: vi.fn(),
      },
      readContext: vi.fn(),
    });
    await session.initialize();
    expect(() => session.signOut()).not.toThrow();
    expect(session.state.value.kind).toBe('signed-out');
    session.dispose();
  });
});
