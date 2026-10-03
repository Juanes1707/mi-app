export type PostCommentsErrorCode =
  | 'invalid-request'
  | 'authentication-required'
  // The current session belongs to another user than the one the read was bound to.
  | 'owner-session-mismatch'
  | 'post-not-found'
  | 'parent-not-found'
  // Targeted read: no such comment under this (visible) post.
  | 'comment-not-found'
  | 'profile-not-ready'
  | 'invalid-response'
  | 'unavailable';

export class PostCommentsError extends Error {
  constructor(readonly code: PostCommentsErrorCode) {
    super(`Post comments operation failed: ${code}.`);
    this.name = 'PostCommentsError';
  }
}
