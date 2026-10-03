export type FeedErrorCode =
  | 'authentication-required'
  | 'invalid-request'
  | 'invalid-response'
  | 'unavailable';

export class FeedError extends Error {
  constructor(readonly code: FeedErrorCode) {
    super(`Feed operation failed: ${code}.`);
    this.name = 'FeedError';
  }
}
