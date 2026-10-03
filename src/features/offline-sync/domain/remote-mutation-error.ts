// Technical failures of sending one queued mutation. None of them proves the
// mutation finished, so the queued entry must always be kept.
// - comment-conflict: the comment UUID already exists with another payload or
//   author. Not a success and not droppable: it means a collision or corruption.
export type RemoteMutationErrorCode =
  | 'authentication-required'
  | 'owner-session-mismatch'
  | 'invalid-request'
  | 'invalid-response'
  | 'comment-conflict'
  | 'unavailable';

export class RemoteMutationError extends Error {
  constructor(readonly code: RemoteMutationErrorCode) {
    super(`Remote mutation failed: ${code}.`);
    this.name = 'RemoteMutationError';
  }
}
