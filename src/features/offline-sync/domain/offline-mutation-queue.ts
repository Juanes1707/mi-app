import type {
  EnqueueSetPostLikeInput, QueuedOfflineMutation, QueuedSetPostLikeMutation,
} from './offline-mutation';

// Durable, owner-scoped, strictly ordered queue of pending user intentions.
// Every operation is scoped to `ownerUserId`, so one account can never read,
// replay or delete another account's pending work on the same device.
export interface OfflineMutationQueue {
  // Resolves only after the INSERT is committed: the intention is then durable.
  // Never coalesces: like, unlike, like are three distinct entries.
  enqueueSetPostLike(input: EnqueueSetPostLikeInput): Promise<QueuedSetPostLikeMutation>;
  // Next entry to replay (lowest sequence) for that owner.
  peekOldest(ownerUserId: string): Promise<QueuedOfflineMutation | null>;
  listPending(ownerUserId: string): Promise<QueuedOfflineMutation[]>;
  // Latest pending desired state for a post; earlier entries are kept for replay.
  getLatestSetPostLike(ownerUserId: string, postId: string): Promise<QueuedSetPostLikeMutation | null>;
  // True only when exactly that owner's entry was deleted; false if it did not exist.
  remove(ownerUserId: string, sequence: number): Promise<boolean>;
  count(ownerUserId: string): Promise<number>;
}
