// `not-found` deliberately covers both "post does not exist" and "actor may not
// see it": the backend does not distinguish them and neither may the UI.
export type PostMediaErrorCode =
  | 'authentication-required'
  | 'invalid-request'
  | 'not-found'
  | 'invalid-response'
  | 'unavailable';

export class PostMediaError extends Error {
  constructor(readonly code: PostMediaErrorCode) {
    super(`Post media operation failed: ${code}.`);
    this.name = 'PostMediaError';
  }
}
