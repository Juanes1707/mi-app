// Technical failures of sending one queued mutation. None of them proves the
// mutation finished, so the queued entry must always be kept.
export type RemoteMutationErrorCode =
  | 'authentication-required'
  | 'owner-session-mismatch'
  | 'invalid-request'
  | 'invalid-response'
  | 'unavailable';

export class RemoteMutationError extends Error {
  constructor(readonly code: RemoteMutationErrorCode) {
    super(`Remote mutation failed: ${code}.`);
    this.name = 'RemoteMutationError';
  }
}
