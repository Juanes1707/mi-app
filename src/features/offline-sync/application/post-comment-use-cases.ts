import type {
  EnqueueCreatePostCommentInput, QueuedCreatePostCommentMutation,
} from '@/features/offline-sync/domain/offline-mutation';
import type { OfflineMutationQueue } from '@/features/offline-sync/domain/offline-mutation-queue';
import { OfflineSyncError } from '@/features/offline-sync/domain/offline-sync-error';
import {
  selectPendingPostComments, type PendingPostComment,
} from '@/features/offline-sync/domain/post-comment-projection';
import { normalizeUuid } from '@/features/offline-sync/domain/uuid';

export interface UuidGenerator {
  // A random (v4) UUID in canonical lowercase form, produced synchronously.
  generate(): string;
}

// The comment's identity is created on the device, before anything is persisted or
// sent: the optimistic row, the SQLite entry and every replay share this UUID, which
// is also the backend's idempotency key.
export class CreatePostCommentId {
  constructor(private readonly ids: UuidGenerator) {}

  execute(): string {
    const id = normalizeUuid(this.ids.generate());
    if (id === null) throw new OfflineSyncError('unavailable');
    return id;
  }
}

// Makes one comment intention durable. No HTTP: syncing is the processor's job.
export class QueueCreatePostComment {
  constructor(private readonly queue: OfflineMutationQueue) {}

  execute(input: EnqueueCreatePostCommentInput): Promise<QueuedCreatePostCommentMutation> {
    return this.queue.enqueueCreatePostComment(input);
  }
}

// Rebuilds a post's pending comments from SQLite with ONE read of the owner's queue
// (no query per comment). Read-only: nothing is deleted, updated or coalesced.
export class GetPendingPostCommentProjection {
  constructor(private readonly queue: OfflineMutationQueue) {}

  async execute(ownerUserId: string, postId: string): Promise<PendingPostComment[]> {
    const normalizedPostId = normalizeUuid(postId);
    if (normalizedPostId === null) throw new OfflineSyncError('invalid-input');
    return selectPendingPostComments(await this.queue.listPending(ownerUserId), normalizedPostId);
  }
}
