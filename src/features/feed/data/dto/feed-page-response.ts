export type FeedPageResponseDto = {
  posts: {
    id: string;
    author: { id: string; username: string | null; displayName: string | null };
    imagePath: string;
    caption: string;
    createdAt: string;
    likesCount: number;
    commentsCount: number;
    isLiked: boolean;
  }[];
  nextCursor: { createdAt: string; postId: string } | null;
};

export function isFeedPageResponseDto(value: unknown): value is FeedPageResponseDto {
  if (!isRecord(value) || !Array.isArray(value.posts)) return false;
  const cursor = value.nextCursor;
  if (cursor !== null && (
    !isRecord(cursor) || !isIsoTimestamp(cursor.createdAt) || !isNonEmptyString(cursor.postId)
  )) return false;

  return value.posts.every((post: unknown) =>
    isRecord(post) &&
    isNonEmptyString(post.id) &&
    isRecord(post.author) &&
    isNonEmptyString(post.author.id) &&
    isNullableString(post.author.username) &&
    isNullableString(post.author.displayName) &&
    isNonEmptyString(post.imagePath) &&
    typeof post.caption === 'string' &&
    isIsoTimestamp(post.createdAt) &&
    isCount(post.likesCount) &&
    isCount(post.commentsCount) &&
    typeof post.isLiked === 'boolean',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
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
