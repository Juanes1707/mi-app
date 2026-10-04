export type PostDetailErrorCode =
  | 'invalid-request'
  | 'authentication-required'
  | 'post-not-found'
  | 'profile-not-ready'
  | 'invalid-response'
  | 'unavailable';

export class PostDetailError extends Error {
  constructor(readonly code: PostDetailErrorCode) {
    super(`Post Detail operation failed: ${code}.`);
    this.name = 'PostDetailError';
  }
}
