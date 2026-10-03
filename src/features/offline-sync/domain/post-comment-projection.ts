import { CREATE_POST_COMMENT, type QueuedOfflineMutation } from './offline-mutation';

// A comment intention that is durable in SQLite and not yet finished remotely.
export type PendingPostComment = {
  sequence: number;
  commentId: string;
  postId: string;
  parentCommentId: string | null;
  body: string;
};

// Read-only view of the queue: the pending comments, in `sequence` order. Never
// coalesced: every row stays an entry (a repeated UUID is still replayed twice).
export function selectPendingPostComments(
  mutations: readonly QueuedOfflineMutation[],
  postId?: string,
): PendingPostComment[] {
  const pending: PendingPostComment[] = [];
  const ordered = [...mutations].sort((a, b) => a.sequence - b.sequence);
  for (const mutation of ordered) {
    if (mutation.kind !== CREATE_POST_COMMENT) continue;
    if (postId !== undefined && mutation.payload.postId !== postId) continue;
    pending.push({ sequence: mutation.sequence, ...mutation.payload });
  }
  return pending;
}
