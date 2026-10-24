export const ParentAccountApi = {
  create: '/api/v1/family-members/parents',
  activation: '/api/v1/parent-activations',
  recoveryEmail: '/api/v1/security/recovery-email',
  removeChild: (memberId: string) => `/api/v1/family-members/${encodeURIComponent(memberId)}`,
  resend: (memberId: string) =>
    `/api/v1/family-members/${encodeURIComponent(memberId)}/welcome-email-resends`,
  email: (memberId: string) =>
    `/api/v1/family-members/${encodeURIComponent(memberId)}/pending-email`,
  cancel: (memberId: string) =>
    `/api/v1/family-members/${encodeURIComponent(memberId)}/pending-account`,
} as const;
export const ParentAccountError = {
  conflict: 'PENDING_ACCOUNT_CONFLICT',
  welcomeUnavailable: 'WELCOME_SETUP_UNAVAILABLE',
  unproven: 'EMAIL_VERIFICATION_REQUIRED',
  unavailable: 'PENDING_ACCOUNT_UNAVAILABLE',
  localRecoveryUnsupported: 'LOCAL_RECOVERY_EMAIL_UNSUPPORTED',
  localUnsupported: 'LOCAL_ACTIVATION_UNSUPPORTED',
  invalidEmail: 'INVALID_EMAIL',
  invalidRequest: 'INVALID_REQUEST',
} as const;
export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const EMAIL_MAX_LENGTH = 254;
