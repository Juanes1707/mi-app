export type PostCommentsErrorCode =
  | 'invalid-request'
  | 'authentication-required'
  | 'post-not-found'
  | 'parent-not-found'
  | 'profile-not-ready'
  | 'invalid-response'
  | 'unavailable';

export class PostCommentsError extends Error {
  constructor(readonly code: PostCommentsErrorCode) {
    super(`Post comments operation failed: ${code}.`);
    this.name = 'PostCommentsError';
  }
}
