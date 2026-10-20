export const SessionDiagnosticOperation = {
  startup: 'startup',
  renewal: 'renewal',
  contextRefresh: 'context-refresh',
  invalidation: 'invalidation',
} as const;
export const SessionDiagnosticOutcome = {
  success: 'success',
  signedOut: 'signed-out',
  recoverableFailure: 'recoverable-failure',
  cancelled: 'cancelled',
} as const;
export interface SessionDiagnostic {
  operation: (typeof SessionDiagnosticOperation)[keyof typeof SessionDiagnosticOperation];
  outcome: (typeof SessionDiagnosticOutcome)[keyof typeof SessionDiagnosticOutcome];
  durationMs: number;
}
const SESSION_DIAGNOSTIC_PREFIX = '[todone-session]';

/** Construct an allowlisted event; never forward SDK errors, state, identity, or payloads. */
export function safeSessionDiagnostic(value: SessionDiagnostic): SessionDiagnostic | null {
  if (
    !Object.values(SessionDiagnosticOperation).includes(value.operation) ||
    !Object.values(SessionDiagnosticOutcome).includes(value.outcome)
  )
    return null;
  return {
    operation: value.operation,
    outcome: value.outcome,
    durationMs: Number.isFinite(value.durationMs) ? Math.max(0, Math.round(value.durationMs)) : 0,
  };
}

/** Local developer console only. Production adds no telemetry or network destination. */
export function recordDevelopmentSessionDiagnostic(value: SessionDiagnostic): void {
  if (!import.meta.env.DEV) return;
  const event = safeSessionDiagnostic(value);
  if (event) console.debug(SESSION_DIAGNOSTIC_PREFIX, JSON.stringify(event));
}
