export type ProfileConnectionsErrorCode =
  | 'invalid-request'
  | 'authentication-required'
  | 'owner-session-mismatch'
  | 'profile-not-found'
  | 'profile-not-ready'
  | 'invalid-response'
  | 'unavailable';

export class ProfileConnectionsError extends Error {
  constructor(readonly code: ProfileConnectionsErrorCode) {
    super(`Profile connections operation failed: ${code}.`);
    this.name = 'ProfileConnectionsError';
  }
}
