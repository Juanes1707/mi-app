import type { PostComment } from '@/features/comments/domain/post-comment';
import { compareCommentPositions } from '@/features/comments/domain/post-comment-values';

// Comments that arrived live and were then re-read through the authorized
// GET /post-comment. They are canonical server data, but they stay OUTSIDE the
// paginated tree: a live comment may sit after rows that are not loaded yet
// (createdAt ASC pages), so it never enters branch ids or moves a cursor. Once a
// normal page contains it, the paginated row wins and it leaves this overlay.
export type RealtimeCommentOverlay = ReadonlyMap<string, PostComment>;

export const EMPTY_REALTIME_OVERLAY: RealtimeCommentOverlay = new Map();

function isSameComment(left: PostComment, right: PostComment): boolean {
  return left.id === right.id && left.postId === right.postId &&
    left.parentCommentId === right.parentCommentId && left.body === right.body &&
    left.createdAt === right.createdAt && left.directRepliesCount === right.directRepliesCount &&
    left.author.id === right.author.id && left.author.username === right.author.username &&
    left.author.displayName === right.author.displayName;
}

// One entry per id: a duplicate Broadcast never duplicates a row. A newer read of the
// same comment (e.g. a reply count that grew) replaces the older one.
export function addRealtimeComment(
  overlay: RealtimeCommentOverlay,
  comment: PostComment,
): RealtimeCommentOverlay {
  const existing = overlay.get(comment.id);
  if (existing !== undefined && isSameComment(existing, comment)) return overlay;
  const next = new Map(overlay);
  next.set(comment.id, comment);
  return next;
}

// Normal pagination reached them: the paginated row is used from now on.
export function pruneRealtimePaginated(
  overlay: RealtimeCommentOverlay,
  paginated: ReadonlyMap<string, PostComment>,
): RealtimeCommentOverlay {
  let next: Map<string, PostComment> | null = null;
  for (const id of overlay.keys()) {
    if (!paginated.has(id)) continue;
    if (next === null) next = new Map(overlay);
    next.delete(id);
  }
  return next ?? overlay;
}

// Live comments of one post grouped by the branch they belong to (parent id, or
// `rootKey` for roots), each group in server order (createdAt, id) — never in the
// order their reads happened to finish.
export function groupRealtimeByBranch(
  overlay: RealtimeCommentOverlay,
  postId: string,
  paginated: ReadonlyMap<string, PostComment>,
  rootKey: string,
): Map<string, PostComment[]> {
  const groups = new Map<string, PostComment[]>();
  for (const comment of overlay.values()) {
    if (comment.postId !== postId || paginated.has(comment.id)) continue;
    const key = comment.parentCommentId ?? rootKey;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [comment]);
    else group.push(comment);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => compareCommentPositions(left, right) ?? 0);
  }
  return groups;
}
