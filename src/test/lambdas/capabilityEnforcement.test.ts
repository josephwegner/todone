import { afterEach, expect, it, vi } from 'vitest';
import { Capability } from '../../../shared/authorizationCapabilities';
import {
  capabilityFailureResponse,
  enforceCapability,
} from '../../../lambdas/authorization/enforcement';
import { memberRepresentation } from '../../../lambdas/authorization/projections';
import type { Principal } from '../../../lambdas/authorization/policy';
afterEach(() => vi.restoreAllMocks());
it('records coarse allow and denial metrics without private principal/context or raw unknown keys', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const parent: Principal = {
    kind: 'active-parent',
    sub: 'secret-sub',
    memberId: 'secret-member',
    householdId: 'secret-home',
  };
  expect(
    enforceCapability(parent, Capability.childRemove, {
      kind: 'member',
      householdId: 'foreign-private',
      memberId: 'private-target',
      role: 'child',
      activationState: 'ACTIVE',
    }),
  ).toBe(false);
  expect(enforceCapability(parent, Capability.directoryRead)).toBe(true);
  const metrics = log.mock.calls.map(([line]) => JSON.parse(line));
  expect(metrics.map((metric) => metric.CapabilityDenied)).toEqual([1, 0]);
  for (const value of [
    'secret-sub',
    'secret-member',
    'secret-home',
    'foreign-private',
    'private-target',
  ])
    expect(JSON.stringify(metrics)).not.toContain(value);
});
it('preserves safe response categories without principal context', () => {
  for (const [principal, expected] of [
    [{ kind: 'anonymous' }, 401],
    [{ kind: 'credentials-stale', sub: 'private-sub' }, 401],
    [{ kind: 'inactive', sub: 'private-sub' }, 403],
    [{ kind: 'inconsistent', sub: 'private-sub' }, 500],
  ] as const) {
    const response = capabilityFailureResponse(principal, 'safe-request');
    expect(response.statusCode).toBe(expected);
    expect(response.body).not.toContain('private-sub');
    expect(capabilityFailureResponse(principal, 'safe-request', true).statusCode).toBe(
      principal.kind === 'anonymous' ? 401 : 404,
    );
  }
});
it('projects self versus peer actions through the same contextual policy', () => {
  const caller = {
    memberId: 'self',
    username: 'caller',
    role: 'parent' as const,
    household: { householdId: 'home', name: 'Home', timezone: 'UTC' },
  };
  const member = {
    memberId: 'self',
    username: 'caller',
    role: 'parent' as const,
    activationState: 'ACTIVE' as const,
  };
  expect(memberRepresentation(caller, member).allowedActions).toEqual([Capability.profileUpdate]);
  expect(memberRepresentation(caller, { ...member, memberId: 'peer' }).allowedActions).toEqual([]);
});
