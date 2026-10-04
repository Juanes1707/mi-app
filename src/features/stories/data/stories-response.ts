import type {
  PublishedStory, StoriesCursor, StoriesPage, Story, StoryAuthor, StoryImageContentType,
  StoryMediaAccess, StoryTray, StoryTrayCursor, StoryTrayPage, StoryUploadTicket,
} from '@/features/stories/domain/story';
import {
  compareStoryPositions, compareTrayPositions, isStoryExpiry, isStoryTimestamp, normalizeStoryUuid,
  parseStoryImagePath, STORY_MEDIA_BUCKET, storyImagePathFor,
} from '@/features/stories/domain/story-values';

// Every backend response is `unknown` until proven to be exactly the contract; nothing
// is reordered or repaired here (out of contract => null => invalid-response).
const USERNAME_PATTERN = /^[A-Za-z0-9._]{3,30}$/;
// Absolute http(s) URL whose authority carries no credentials (no '@').
const SIGNED_URL_PATTERN = /^https?:\/\/[^/?#@\s]+(?:[/?#]\S*)?$/i;
const MAX_SIGNED_URL_TTL_SECONDS = 3600;

export function parseStoryTrayPage(
  value: unknown,
  expected: { ownerUserId: string; limit: number; cursor: StoryTrayCursor | null },
): StoryTrayPage | null {
  if (!hasExactFields(value, ['trays', 'nextCursor']) || !Array.isArray(value.trays) ||
      value.trays.length > expected.limit) return null;
  const trays: StoryTray[] = [];
  const seen = new Set<string>();
  let previous: StoryTrayCursor | null = expected.cursor;
  for (const item of value.trays as unknown[]) {
    if (!hasExactFields(item, ['author', 'latestStoryCreatedAt', 'activeStoryCount', 'isSelf'])) return null;
    const author = parseAuthor(item.author);
    if (author === null || typeof item.isSelf !== 'boolean' || item.isSelf !== (author.id === expected.ownerUserId) ||
        !isStoryTimestamp(item.latestStoryCreatedAt) || typeof item.activeStoryCount !== 'number' ||
        !Number.isSafeInteger(item.activeStoryCount) || item.activeStoryCount < 1 || seen.has(author.id)) return null;
    seen.add(author.id);
    const position = { isSelf: item.isSelf, latestStoryCreatedAt: item.latestStoryCreatedAt, authorId: author.id };
    if (previous !== null) {
      const order = compareTrayPositions(previous, position);
      if (order === null || order >= 0) return null;
    }
    previous = position;
    trays.push({
      author, latestStoryCreatedAt: item.latestStoryCreatedAt,
      activeStoryCount: item.activeStoryCount, isSelf: item.isSelf,
    });
  }
  const nextCursor = parseTrayCursor(value.nextCursor);
  if (nextCursor === undefined) return null;
  const last = trays[trays.length - 1];
  if (nextCursor !== null && (trays.length !== expected.limit || last === undefined ||
      nextCursor.isSelf !== last.isSelf || nextCursor.authorId !== last.author.id ||
      nextCursor.latestStoryCreatedAt !== last.latestStoryCreatedAt)) return null;
  return { trays, nextCursor };
}

export function parseStoriesPage(
  value: unknown,
  expected: { authorId: string; limit: number; cursor: StoriesCursor | null },
): StoriesPage | null {
  if (!hasExactFields(value, ['stories', 'nextCursor']) || !Array.isArray(value.stories) ||
      value.stories.length > expected.limit) return null;
  const stories: Story[] = [];
  const seen = new Set<string>();
  let previous = expected.cursor === null ? null : { createdAt: expected.cursor.createdAt, id: expected.cursor.storyId };
  for (const item of value.stories as unknown[]) {
    const story = parseStory(item, expected.authorId);
    if (story === null || seen.has(story.id)) return null;
    seen.add(story.id);
    if (previous !== null) {
      const order = compareStoryPositions(previous, story);
      if (order === null || order >= 0) return null;
    }
    previous = { createdAt: story.createdAt, id: story.id };
    stories.push(story);
  }
  const nextCursor = parseStoriesCursor(value.nextCursor);
  if (nextCursor === undefined) return null;
  const last = stories[stories.length - 1];
  if (nextCursor !== null && (stories.length !== expected.limit || last === undefined ||
      nextCursor.storyId !== last.id || nextCursor.createdAt !== last.createdAt)) return null;
  return { stories, nextCursor };
}

export function parseStoryUploadTicket(
  value: unknown,
  expected: { ownerUserId: string; storyId: string; contentType: StoryImageContentType },
): StoryUploadTicket | null {
  if (!hasExactFields(value, ['upload']) || !hasExactFields(value.upload, ['storyId', 'bucket', 'path', 'token'])) return null;
  const upload = value.upload;
  // The server chose the path; it must be exactly the one for this owner and Story.
  if (upload.storyId !== expected.storyId || upload.bucket !== STORY_MEDIA_BUCKET ||
      upload.path !== storyImagePathFor(expected.ownerUserId, expected.storyId, expected.contentType) ||
      typeof upload.token !== 'string' || upload.token.trim() === '') return null;
  return { storyId: expected.storyId, bucket: STORY_MEDIA_BUCKET, path: upload.path, token: upload.token };
}

export function parsePublishedStory(
  value: unknown,
  expected: { ownerUserId: string; storyId: string; imagePath: string },
): PublishedStory | null {
  if (!hasExactFields(value, ['story']) ||
      !hasExactFields(value.story, ['id', 'authorId', 'imagePath', 'createdAt', 'expiresAt'])) return null;
  const story = value.story;
  if (story.id !== expected.storyId || story.authorId !== expected.ownerUserId ||
      story.imagePath !== expected.imagePath || !isStoryTimestamp(story.createdAt) ||
      !isStoryTimestamp(story.expiresAt) || !isStoryExpiry(story.createdAt, story.expiresAt)) return null;
  return {
    id: expected.storyId, authorId: expected.ownerUserId, imagePath: expected.imagePath,
    createdAt: story.createdAt, expiresAt: story.expiresAt,
  };
}

export function parseStoryMediaAccess(value: unknown, storyId: string): StoryMediaAccess | null {
  if (!hasExactFields(value, ['media']) ||
      !hasExactFields(value.media, ['storyId', 'imagePath', 'signedUrl', 'expiresInSeconds'])) return null;
  const media = value.media;
  const path = parseStoryImagePath(media.imagePath);
  if (media.storyId !== storyId || path === null || path.storyId !== storyId ||
      typeof media.imagePath !== 'string' || typeof media.signedUrl !== 'string' ||
      !SIGNED_URL_PATTERN.test(media.signedUrl) || typeof media.expiresInSeconds !== 'number' ||
      !Number.isSafeInteger(media.expiresInSeconds) || media.expiresInSeconds < 1 ||
      media.expiresInSeconds > MAX_SIGNED_URL_TTL_SECONDS) return null;
  return { storyId, imagePath: media.imagePath, signedUrl: media.signedUrl, expiresInSeconds: media.expiresInSeconds };
}

function parseStory(value: unknown, authorId: string): Story | null {
  if (!hasExactFields(value, ['id', 'author', 'imagePath', 'createdAt', 'expiresAt'])) return null;
  const id = normalizeStoryUuid(value.id);
  const author = parseAuthor(value.author);
  const path = parseStoryImagePath(value.imagePath);
  if (id === null || id !== value.id || author === null || author.id !== authorId || path === null ||
      path.authorId !== authorId || path.storyId !== id || typeof value.imagePath !== 'string' ||
      !isStoryTimestamp(value.createdAt) || !isStoryTimestamp(value.expiresAt) ||
      !isStoryExpiry(value.createdAt, value.expiresAt)) return null;
  return { id, author, imagePath: value.imagePath, createdAt: value.createdAt, expiresAt: value.expiresAt };
}

function parseAuthor(value: unknown): StoryAuthor | null {
  if (!hasExactFields(value, ['id', 'username', 'displayName'])) return null;
  const id = normalizeStoryUuid(value.id);
  if (id === null || id !== value.id ||
      (value.username !== null && (typeof value.username !== 'string' || !USERNAME_PATTERN.test(value.username))) ||
      (value.displayName !== null && typeof value.displayName !== 'string')) return null;
  return { id, username: value.username, displayName: value.displayName };
}

function parseTrayCursor(value: unknown): StoryTrayCursor | null | undefined {
  if (value === null) return null;
  if (!hasExactFields(value, ['isSelf', 'latestStoryCreatedAt', 'authorId']) || typeof value.isSelf !== 'boolean' ||
      !isStoryTimestamp(value.latestStoryCreatedAt)) return undefined;
  const authorId = normalizeStoryUuid(value.authorId);
  return authorId === null || authorId !== value.authorId
    ? undefined : { isSelf: value.isSelf, latestStoryCreatedAt: value.latestStoryCreatedAt, authorId };
}

function parseStoriesCursor(value: unknown): StoriesCursor | null | undefined {
  if (value === null) return null;
  if (!hasExactFields(value, ['createdAt', 'storyId']) || !isStoryTimestamp(value.createdAt)) return undefined;
  const storyId = normalizeStoryUuid(value.storyId);
  return storyId === null || storyId !== value.storyId ? undefined : { createdAt: value.createdAt, storyId };
}

function hasExactFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}
