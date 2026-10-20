import type { SessionFailure } from './sessionController';

const SESSION_CREDENTIALS_UNAVAILABLE = 'SESSION_CREDENTIALS_UNAVAILABLE';
const SESSION_OPERATION_CANCELLED = 'SESSION_OPERATION_CANCELLED';

export class SessionCredentialsUnavailableError extends Error {
  constructor(readonly failure: SessionFailure) {
    super(SESSION_CREDENTIALS_UNAVAILABLE);
  }
}
export class SessionOperationCancelledError extends Error {
  constructor() {
    super(SESSION_OPERATION_CANCELLED);
  }
}
