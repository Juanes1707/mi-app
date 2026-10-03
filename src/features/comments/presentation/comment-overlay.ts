import type { PostComment } from '@/features/comments/domain/post-comment';
import type { PendingPostComment } from '@/features/offline-sync/domain/post-comment-projection';

// - saving: only in memory, SQLite has not confirmed it yet (not durable).
// - pending: durable in SQLite, survives process death, waiting for (or blocked in) sync.
// - sent: it left the queue after a terminal remote outcome, but no loaded server page
//   contains it yet (pages are createdAt ASC), so it stays visible instead of vanishing.
// - save-error: SQLite did not store it. Not durable; the text is kept for retry/discard.
export type LocalCommentStatus = 'saving' | 'pending' | 'sent' | 'save-error';

// One comment intention of the signed-in user, shown over the server tree. It never
// enters the server tree's branch ids or cursors: it is a projection, not data.
export type LocalComment = {
  commentId: string;
  postId: string;
  parentCommentId: string | null;
  body: string;
  status: LocalCommentStatus;
  // Visual order among local comments: tap order for new sends, `sequence` order for
  // comments recovered from SQLite. Assigned once, so saving → pending never moves.
  localOrder: number;
  sequence: number | null;
  // Projection reads numbered above this value started after the entry was known to
  // be durable: only those can prove it left the queue (older reads may predate it).
  durableSince: number | null;
};

export type CommentOverlay = {
  ownerUserId: string | null;
  // Ascending localOrder.
  entries: readonly LocalComment[];
};

export const EMPTY_OVERLAY: CommentOverlay = { ownerUserId: null, entries: [] };

// The server row is THIS intention: same id, post, parent, body, and authored by the
// owner. Same id with anything else is an inconsistency: both rows stay visible and
// nothing is overwritten.
export function isCanonicalMatch(
  local: LocalComment,
  node: PostComment | undefined,
  ownerUserId: string | null,
): boolean {
  return node !== undefined && ownerUserId !== null &&
    node.postId === local.postId &&
    node.parentCommentId === local.parentCommentId &&
    node.body === local.body &&
    node.author.id === ownerUserId;
}

// A reply needs a parent whose intention is already durable: otherwise the reply could
// be persisted while the parent never is.
export function canReplyToLocal(local: LocalComment): boolean {
  return local.status === 'pending' || local.status === 'sent';
}

export function markLocalDurable(
  entries: readonly LocalComment[],
  commentId: string,
  sequence: number,
  durableSince: number,
): readonly LocalComment[] {
  return update(entries, commentId, (entry) => {
    if (entry.status === 'sent') return entry;
    return {
      ...entry,
      status: 'pending',
      sequence: entry.sequence === null ? sequence : Math.min(entry.sequence, sequence),
      durableSince: entry.durableSince ?? durableSince,
    };
  });
}

export function markLocalSaveError(entries: readonly LocalComment[], commentId: string) {
  return update(entries, commentId, (entry) =>
    entry.status === 'saving' ? { ...entry, status: 'save-error' } : entry);
}

export function markLocalSaving(entries: readonly LocalComment[], commentId: string) {
  return update(entries, commentId, (entry) =>
    entry.status === 'save-error' ? { ...entry, status: 'saving' } : entry);
}

// Only an intention that never reached SQLite can be discarded. This is not a delete.
export function discardLocal(entries: readonly LocalComment[], commentId: string) {
  const next = entries.filter((entry) => !(entry.commentId === commentId && entry.status === 'save-error'));
  return next.length === entries.length ? entries : next;
}

// Applies one full projection read (`requestId`) of this post's pending comments:
// - found: the intention is durable (even one shown as save-error: its INSERT did
//   commit), so it is pending;
// - pending, missing from a read that started after it was durable: it left the
//   queue → sent (kept visible until a server page contains it);
// - unknown to this screen (e.g. recovered after process death): added, in sequence order.
export function mergePendingProjection(
  entries: readonly LocalComment[],
  pending: readonly PendingPostComment[],
  requestId: number,
  nextLocalOrder: () => number,
): { entries: readonly LocalComment[]; sent: LocalComment[] } {
  const queued = new Map<string, PendingPostComment>();
  for (const item of pending) if (!queued.has(item.commentId)) queued.set(item.commentId, item);

  let changed = false;
  const sent: LocalComment[] = [];
  const next = entries.map((entry) => {
    const item = queued.get(entry.commentId);
    if (item !== undefined) {
      queued.delete(entry.commentId);
      if (entry.status === 'pending' && entry.sequence !== null) return entry;
      changed = true;
      return {
        ...entry,
        status: 'pending' as const,
        sequence: item.sequence,
        durableSince: entry.durableSince ?? requestId,
      };
    }
    if (entry.status === 'pending' && entry.durableSince !== null && requestId > entry.durableSince) {
      changed = true;
      const done = { ...entry, status: 'sent' as const };
      sent.push(done);
      return done;
    }
    return entry;
  });

  for (const item of queued.values()) {
    changed = true;
    next.push({
      commentId: item.commentId,
      postId: item.postId,
      parentCommentId: item.parentCommentId,
      body: item.body,
      status: 'pending',
      localOrder: nextLocalOrder(),
      sequence: item.sequence,
      durableSince: requestId,
    });
  }
  return { entries: changed ? next : entries, sent };
}

// A sent intention that a server page now contains is done: the canonical row is
// shown and the overlay entry is dropped. Pending ones are only hidden (flatten),
// because SQLite still holds them and a refresh must not make them disappear.
export function pruneCanonicalSent(
  entries: readonly LocalComment[],
  nodes: ReadonlyMap<string, PostComment>,
  ownerUserId: string | null,
): readonly LocalComment[] {
  const next = entries.filter((entry) =>
    !(entry.status === 'sent' && isCanonicalMatch(entry, nodes.get(entry.commentId), ownerUserId)));
  return next.length === entries.length ? entries : next;
}

function update(
  entries: readonly LocalComment[],
  commentId: string,
  change: (entry: LocalComment) => LocalComment,
): readonly LocalComment[] {
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.commentId !== commentId) return entry;
    const updated = change(entry);
    if (updated !== entry) changed = true;
    return updated;
  });
  return changed ? next : entries;
}
