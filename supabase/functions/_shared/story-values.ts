import { timestampOrderKey } from './values.ts';

// Story media rules shared by the stories and story-media Edge Functions.
export type StoryContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type StoryImagePath = { authorId: string; storyId: string; contentType: StoryContentType };

export const STORY_MEDIA_BUCKET = 'story-media';
export const MAX_STORY_IMAGE_BYTES = 10 * 1024 * 1024;
const STORY_LIFETIME_MICROSECONDS = 24n * 60n * 60n * 1_000_000n;
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STORY_IMAGE_PATH_PATTERN = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp)$/;
const EXTENSION_BY_CONTENT_TYPE: Record<StoryContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const CONTENT_TYPE_BY_EXTENSION: Record<string, StoryContentType> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function isStoryContentType(value: unknown): value is StoryContentType {
  return typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(EXTENSION_BY_CONTENT_TYPE, value);
}

// The ONLY path a Story object can have: '<author>/<story>.<ext>', canonical lowercase,
// built server-side from the JWT actor and the client-generated Story id.
export function buildStoryImagePath(
  authorId: string,
  storyId: string,
  contentType: StoryContentType,
): string {
  return `${authorId}/${storyId}.${EXTENSION_BY_CONTENT_TYPE[contentType]}`;
}

// Inverse of buildStoryImagePath; anything else (case variants, '..', extra segments,
// other extensions) is not a Story path.
export function parseStoryImagePath(value: unknown): StoryImagePath | null {
  if (typeof value !== 'string') return null;
  const match = STORY_IMAGE_PATH_PATTERN.exec(value);
  const authorId = match?.[1];
  const storyId = match?.[2];
  const extension = match?.[3];
  if (authorId === undefined || storyId === undefined || extension === undefined ||
      !CANONICAL_UUID_PATTERN.test(authorId) || !CANONICAL_UUID_PATTERN.test(storyId)) return null;
  const contentType = CONTENT_TYPE_BY_EXTENSION[extension];
  return contentType === undefined ? null : { authorId, storyId, contentType };
}

// A Story lives exactly 24 hours: expires_at = created_at + 24 h, to the microsecond.
export function isStoryExpiry(createdAt: unknown, expiresAt: unknown): boolean {
  const created = timestampOrderKey(createdAt);
  const expires = timestampOrderKey(expiresAt);
  return created !== null && expires !== null && expires - created === STORY_LIFETIME_MICROSECONDS;
}
