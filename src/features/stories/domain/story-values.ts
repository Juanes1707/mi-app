import type { StoryImageContentType } from '@/features/stories/domain/story';
import {
  comparePostgresTimestamps, microsecondsBetween, parsePostgresTimestamp,
} from '@/shared/domain/postgres-timestamp';
import { normalizeUuid } from '@/shared/domain/uuid';

export const MAX_STORY_IMAGE_BYTES = 10 * 1024 * 1024;
export const STORY_MEDIA_BUCKET = 'story-media';
const STORY_LIFETIME_MICROSECONDS = 24 * 60 * 60 * 1_000_000;
const CANONICAL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STORY_IMAGE_PATH_PATTERN = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\.(jpg|png|webp)$/;
const EXTENSION_BY_CONTENT_TYPE: Record<StoryImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const CONTENT_TYPE_BY_EXTENSION: Record<string, StoryImageContentType> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function normalizeStoryUuid(value: unknown): string | null {
  return normalizeUuid(value);
}

export function isStoryImageContentType(value: unknown): value is StoryImageContentType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EXTENSION_BY_CONTENT_TYPE, value);
}

export function isStoryTimestamp(value: unknown): value is string {
  return parsePostgresTimestamp(value) !== null;
}

// The only object path the backend issues: '<author>/<story>.<ext>', canonical lowercase.
export function storyImagePathFor(authorId: string, storyId: string, contentType: StoryImageContentType): string {
  return `${authorId}/${storyId}.${EXTENSION_BY_CONTENT_TYPE[contentType]}`;
}

export function parseStoryImagePath(value: unknown): { authorId: string; storyId: string } | null {
  if (typeof value !== 'string') return null;
  const match = STORY_IMAGE_PATH_PATTERN.exec(value);
  if (match === null || !CANONICAL_UUID_PATTERN.test(match[1]) || !CANONICAL_UUID_PATTERN.test(match[2]) ||
      CONTENT_TYPE_BY_EXTENSION[match[3]] === undefined) return null;
  return { authorId: match[1], storyId: match[2] };
}

// A Story lives exactly 24 hours: expiresAt = createdAt + 24 h, to the microsecond
// (not Date.getTime(), which would lose the last three fraction digits).
export function isStoryExpiry(createdAt: string, expiresAt: string): boolean {
  const created = parsePostgresTimestamp(createdAt);
  const expires = parsePostgresTimestamp(expiresAt);
  return created !== null && expires !== null &&
    microsecondsBetween(created, expires) === STORY_LIFETIME_MICROSECONDS;
}

// Story playback order: createdAt ASC, id ASC. Negative when left comes first.
export function compareStoryPositions(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string },
): number | null {
  const leftTime = parsePostgresTimestamp(left.createdAt);
  const rightTime = parsePostgresTimestamp(right.createdAt);
  if (leftTime === null || rightTime === null) return null;
  const byTime = comparePostgresTimestamps(leftTime, rightTime);
  if (byTime !== 0) return byTime;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

// Tray order: isSelf DESC, latestStoryCreatedAt DESC, authorId DESC. Negative when left comes first.
export function compareTrayPositions(
  left: { isSelf: boolean; latestStoryCreatedAt: string; authorId: string },
  right: { isSelf: boolean; latestStoryCreatedAt: string; authorId: string },
): number | null {
  if (left.isSelf !== right.isSelf) return left.isSelf ? -1 : 1;
  const leftTime = parsePostgresTimestamp(left.latestStoryCreatedAt);
  const rightTime = parsePostgresTimestamp(right.latestStoryCreatedAt);
  if (leftTime === null || rightTime === null) return null;
  const byTime = comparePostgresTimestamps(rightTime, leftTime);
  if (byTime !== 0) return byTime;
  return left.authorId > right.authorId ? -1 : left.authorId < right.authorId ? 1 : 0;
}

// Every static image Story plays for exactly this long (the single source of truth).
export const STORY_IMAGE_DURATION_MS = 5000;
