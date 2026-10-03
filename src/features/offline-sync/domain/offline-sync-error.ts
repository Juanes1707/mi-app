// - invalid-input: the caller passed something that must never be persisted.
// - unavailable: the local store could not be opened or queried.
// - corrupt-data: a persisted entry is unreadable; the queue must stop, never skip it.
// - unsupported-version: the database was written by a newer app version; kept intact.
export type OfflineSyncErrorCode =
  | 'invalid-input'
  | 'unavailable'
  | 'corrupt-data'
  | 'unsupported-version';

export class OfflineSyncError extends Error {
  constructor(readonly code: OfflineSyncErrorCode, options?: { cause?: unknown }) {
    super(`Offline sync operation failed: ${code}.`, options);
    this.name = 'OfflineSyncError';
  }
}
