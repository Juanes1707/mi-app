export type PostCreateErrorCode =
  | 'authentication-required' | 'invalid-image' | 'image-too-large' | 'invalid-caption'
  | 'upload-unavailable' | 'media-not-ready' | 'profile-not-ready'
  | 'invalid-response' | 'invalid-request' | 'unavailable';

export class PostCreateError extends Error {
  constructor(readonly code: PostCreateErrorCode) {
    super(`Post creation failed: ${code}.`);
    this.name = 'PostCreateError';
  }
}
