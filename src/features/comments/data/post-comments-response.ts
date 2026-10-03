import type {
  PostComment,
  PostCommentsCursor,
  PostCommentsPage,
} from '@/features/comments/domain/post-comment';
import {
  compareCommentPositions,
  isSameUuid,
  isUuid,
  parseCommentTimestamp,
} from '@/features/comments/domain/post-comment-values';

export type ExpectedPostCommentsPage = {
  postId: string;
  parentCommentId: string | null;
  limit: number;
  cursor: PostCommentsCursor | null;
};

const PAGE_FIELDS = ['comments', 'nextCursor'];
const COMMENT_FIELDS = [
  'id', 'postId', 'parentCommentId', 'author', 'body', 'createdAt', 'directRepliesCount',
];
const AUTHOR_FIELDS = ['id', 'username', 'displayName'];
const CURSOR_FIELDS = ['createdAt', 'commentId'];
// profiles.username: null, or 3-30 of [A-Za-z0-9._].
const USERNAME_PATTERN = /^[A-Za-z0-9._]{3,30}$/;
const MAX_BODY_CODE_POINTS = 500;

// Validates a 200 body of GET /post-comments against the request that produced it.
// Returns null for anything off-contract; it never reorders, trims or repairs rows.
export function parsePostCommentsPage(
  value: unknown,
  expected: ExpectedPostCommentsPage,
): PostCommentsPage | null {
  if (!hasExactFields(value, PAGE_FIELDS) || !Array.isArray(value.comments)) return null;
  if (value.comments.length > expected.limit) return null;

  const comments: PostComment[] = [];
  const seenIds = new Set<string>();
  let previous: { createdAt: string; id: string } | null = expected.cursor === null
    ? null
    : { createdAt: expected.cursor.createdAt, id: expected.cursor.commentId };

  for (const item of value.comments as unknown[]) {
    const comment = parseComment(item, expected);
    if (comment === null) return null;

    if (seenIds.has(comment.id)) return null;
    seenIds.add(comment.id);

    // Strictly after the previous row, and the first row strictly after the cursor:
    // duplicates and out-of-order rows are rejected, not sorted away.
    if (previous !== null) {
      const order = compareCommentPositions(previous, comment);
      if (order === null || order >= 0) return null;
    }
    previous = comment;
    comments.push(comment);
  }

  const nextCursor = parseCursor(value.nextCursor);
  if (nextCursor === undefined) return null;
  if (nextCursor !== null) {
    // The backend only announces more rows after a full page, pointing at its last row.
    const last = comments[comments.length - 1];
    if (
      comments.length !== expected.limit || last === undefined ||
      nextCursor.createdAt !== last.createdAt || nextCursor.commentId !== last.id
    ) return null;
  }

  return { comments, nextCursor };
}

// Validates a 200 body of GET /post-comment: exactly { comment }, the same comment DTO
// as a page row, and it must be the requested comment of the requested post (its
// parent can be any: null for a root, a UUID for a reply).
export function parseSinglePostComment(
  value: unknown,
  expected: { postId: string; commentId: string },
): PostComment | null {
  if (!hasExactFields(value, ['comment'])) return null;
  const comment = parseComment(value.comment, { postId: expected.postId, parentCommentId: undefined });
  return comment !== null && isSameUuid(comment.id, expected.commentId) ? comment : null;
}

// `parentCommentId: undefined` accepts any parent (targeted read); otherwise the row
// must belong exactly to that sibling set (page read).
function parseComment(
  value: unknown,
  expected: { postId: string; parentCommentId: string | null | undefined },
): PostComment | null {
  if (!hasExactFields(value, COMMENT_FIELDS)) return null;
  const { id, postId, parentCommentId, author, body, createdAt, directRepliesCount } = value;
  if (!hasExactFields(author, AUTHOR_FIELDS)) return null;
  const { username, displayName } = author;

  if (
    !isUuid(id) ||
    !isUuid(postId) || !isSameUuid(postId, expected.postId) ||
    !matchesExpectedParent(parentCommentId, expected.parentCommentId) ||
    !isUuid(author.id) ||
    !(username === null || (typeof username === 'string' && USERNAME_PATTERN.test(username))) ||
    !(displayName === null || typeof displayName === 'string') ||
    typeof body !== 'string' || body.trim() === '' ||
    [...body].length > MAX_BODY_CODE_POINTS ||
    typeof createdAt !== 'string' || parseCommentTimestamp(createdAt) === null ||
    typeof directRepliesCount !== 'number' ||
    !Number.isSafeInteger(directRepliesCount) || directRepliesCount < 0
  ) return null;

  // UUIDs are returned in one canonical (lowercase) spelling so the tree can use
  // them as exact keys; timestamps are kept verbatim because they become cursors.
  return {
    id: id.toLowerCase(),
    postId: postId.toLowerCase(),
    parentCommentId: parentCommentId === null ? null : parentCommentId.toLowerCase(),
    author: { id: author.id.toLowerCase(), username, displayName },
    // Kept byte for byte: leading/trailing spaces and line breaks are content.
    body,
    createdAt,
    directRepliesCount,
  };
}

function matchesExpectedParent(
  value: unknown,
  expected: string | null | undefined,
): value is string | null {
  if (expected === undefined) return value === null || isUuid(value);
  if (expected === null) return value === null;
  return isUuid(value) && isSameUuid(value, expected);
}

// undefined = invalid, null = no more pages.
function parseCursor(value: unknown): PostCommentsCursor | null | undefined {
  if (value === null) return null;
  if (!hasExactFields(value, CURSOR_FIELDS)) return undefined;
  const { createdAt, commentId } = value;
  if (
    typeof createdAt !== 'string' || parseCommentTimestamp(createdAt) === null ||
    !isUuid(commentId)
  ) return undefined;
  return { createdAt, commentId: commentId.toLowerCase() };
}

function hasExactFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}
