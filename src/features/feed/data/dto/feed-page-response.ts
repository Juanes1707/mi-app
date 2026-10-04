export type FeedPostResponseDto = {
  id: string;
  author: { id: string; username: string | null; displayName: string | null };
  imagePath: string;
  caption: string;
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
};

export type FeedPageResponseDto = {
  posts: FeedPostResponseDto[];
  nextCursor: { createdAt: string; postId: string } | null;
};

const POST_FIELDS = new Set([
  'id', 'author', 'imagePath', 'caption', 'createdAt', 'likesCount', 'commentsCount', 'isLiked',
]);
const AUTHOR_FIELDS = new Set(['id', 'username', 'displayName']);
const PAGE_FIELDS = new Set(['posts', 'nextCursor']);
const CURSOR_FIELDS = new Set(['createdAt', 'postId']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isFeedPageResponseDto(value: unknown): value is FeedPageResponseDto {
  if (!isRecord(value) || !hasExactFields(value, PAGE_FIELDS) || !Array.isArray(value.posts)) return false;
  const cursor = value.nextCursor;
  if (cursor !== null && (
    !isRecord(cursor) || !hasExactFields(cursor, CURSOR_FIELDS) ||
    !isIsoTimestamp(cursor.createdAt) || !isUuid(cursor.postId)
  )) return false;

  return value.posts.every(isFeedPostResponseDto);
}

export function isFeedPostResponseDto(value: unknown): value is FeedPostResponseDto {
  if (!isRecord(value) || !hasExactFields(value, POST_FIELDS)) return false;
  const author = value.author;

  return isUuid(value.id) &&
    isRecord(author) && hasExactFields(author, AUTHOR_FIELDS) &&
    isUuid(author.id) &&
    isNullableString(author.username) &&
    isNullableString(author.displayName) &&
    isNonEmptyString(value.imagePath) && value.imagePath.trim() === value.imagePath &&
    typeof value.caption === 'string' &&
    isIsoTimestamp(value.createdAt) &&
    isCount(value.likesCount) &&
    isCount(value.commentsCount) &&
    typeof value.isLiked === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
function hasExactFields(value: Record<string, unknown>, fields: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}
function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// Accept the backend's timezone and microsecond precision without rewriting the cursor.
function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59 &&
    Number(match[7] ?? 0) <= 23 && Number(match[8] ?? 0) <= 59 &&
    Number.isFinite(Date.parse(value));
}
