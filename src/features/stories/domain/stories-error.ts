export type StoriesErrorCode =
  | 'invalid-request' | 'invalid-image' | 'image-too-large'
  | 'authentication-required' | 'owner-session-mismatch' | 'profile-not-ready'
  | 'author-not-found' | 'story-not-found' | 'story-id-conflict' | 'media-not-ready'
  | 'upload-unavailable' | 'invalid-response' | 'unavailable';

export class StoriesError extends Error {
  constructor(readonly code: StoriesErrorCode) {
    super(`Stories operation failed: ${code}.`);
    this.name = 'StoriesError';
  }
}
