export type DirectMessagesErrorCode =
  | 'invalid-request' | 'authentication-required' | 'owner-session-mismatch'
  | 'recipient-not-found' | 'conversation-not-found' | 'message-not-found' | 'profile-not-ready'
  | 'message-conflict' | 'invalid-response' | 'unavailable';

export class DirectMessagesError extends Error {
  constructor(readonly code: DirectMessagesErrorCode) {
    super(`Direct Messages operation failed: ${code}.`);
    this.name = 'DirectMessagesError';
  }
}
