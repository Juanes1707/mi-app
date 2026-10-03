import type {
  EnqueueSetPostLikeInput, QueuedSetPostLikeMutation,
} from '@/features/offline-sync/domain/offline-mutation';
import type { OfflineMutationQueue } from '@/features/offline-sync/domain/offline-mutation-queue';
import { reducePendingPostLikes } from '@/features/offline-sync/domain/post-like-projection';

// Makes one like/unlike intention durable. No HTTP: syncing is the processor's job.
export class QueueSetPostLike {
  constructor(private readonly queue: OfflineMutationQueue) {}

  execute(input: EnqueueSetPostLikeInput): Promise<QueuedSetPostLikeMutation> {
    return this.queue.enqueueSetPostLike(input);
  }
}

// Rebuilds the pending desired state per post from SQLite in one read. Read-only:
// nothing is deleted, updated or coalesced.
export class GetPendingPostLikeProjection {
  constructor(private readonly queue: OfflineMutationQueue) {}

  async execute(ownerUserId: string): Promise<ReadonlyMap<string, boolean>> {
    return reducePendingPostLikes(await this.queue.listPending(ownerUserId));
  }
}
