import type { CurrentUserProvider } from '@/features/offline-sync/application/current-user-provider';
import {
  CREATE_POST_COMMENT, SET_POST_LIKE, type QueuedCreatePostCommentMutation, type QueuedOfflineMutation,
  type QueuedSetPostLikeMutation,
} from '@/features/offline-sync/domain/offline-mutation';
import type { OfflineMutationQueue } from '@/features/offline-sync/domain/offline-mutation-queue';
import { OfflineSyncError } from '@/features/offline-sync/domain/offline-sync-error';
import type { PostCommentRemoteGateway } from '@/features/offline-sync/domain/post-comment-remote-gateway';
import type { PostLikeRemoteGateway } from '@/features/offline-sync/domain/post-like-remote-gateway';
import { RemoteMutationError } from '@/features/offline-sync/domain/remote-mutation-error';
import { normalizeUuid } from '@/features/offline-sync/domain/uuid';

export type DrainBlockReason =
  | 'profile-not-ready'
  | 'authentication-required'
  | 'owner-session-mismatch'
  | 'invalid-request'
  | 'invalid-response'
  // The comment UUID already exists with another payload or author.
  | 'comment-conflict'
  | 'unavailable'
  | 'corrupt-data'
  | 'unsupported-version'
  // A terminal mutation could not be removed as expected: an invariant is broken.
  | 'queue-inconsistent';

export type OfflineMutationDrainResult =
  | { kind: 'drained'; ownerUserId: string; processedCount: number }
  | { kind: 'not-authenticated'; ownerUserId: string | null; processedCount: number }
  // The session now belongs to another user: the previous owner's queue is left as is.
  | { kind: 'session-changed'; ownerUserId: string; processedCount: number }
  // `sequence` is null when the blocking entry could not be identified (e.g. unreadable row).
  | {
      kind: 'blocked';
      ownerUserId: string | null;
      processedCount: number;
      sequence: number | null;
      reason: DrainBlockReason;
    };

type CurrentUserRead =
  | { kind: 'user'; id: string }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' };

type SendOutcome = 'terminal' | 'signed-out' | DrainBlockReason;

function blocked(
  ownerUserId: string | null,
  processedCount: number,
  sequence: number | null,
  reason: DrainBlockReason,
): OfflineMutationDrainResult {
  return { kind: 'blocked', ownerUserId, processedCount, sequence, reason };
}

function queueFailureReason(error: unknown): DrainBlockReason {
  if (error instanceof OfflineSyncError &&
    (error.code === 'corrupt-data' || error.code === 'unsupported-version')) {
    return error.code;
  }
  return 'unavailable';
}

// Replays the current user's queue strictly in `sequence` order, one entry at a time,
// whatever its kind (likes and comments share one global order):
//   peek oldest → send → terminal? remove and peek again : stop, keeping the entry.
// An entry that cannot be completed blocks everything after it: skipping it would
// change the meaning of the user's history (and a reply must never overtake the
// comment it answers). No retries or timers live here; callers decide when to drain.
export class OfflineMutationProcessor {
  private activeDrain: Promise<OfflineMutationDrainResult> | null = null;

  constructor(
    private readonly queue: OfflineMutationQueue,
    private readonly currentUser: CurrentUserProvider,
    private readonly postLikes: PostLikeRemoteGateway,
    private readonly postComments: PostCommentRemoteGateway,
  ) {}

  // Concurrent triggers share the drain already running instead of starting another.
  drainCurrentUser(): Promise<OfflineMutationDrainResult> {
    if (this.activeDrain !== null) return this.activeDrain;
    const drain = this.drain().finally(() => {
      if (this.activeDrain === drain) this.activeDrain = null;
    });
    this.activeDrain = drain;
    return drain;
  }

  private async drain(): Promise<OfflineMutationDrainResult> {
    const start = await this.readCurrentUser();
    if (start.kind === 'unavailable') return blocked(null, 0, null, 'unavailable');
    if (start.kind === 'signed-out') {
      return { kind: 'not-authenticated', ownerUserId: null, processedCount: 0 };
    }
    const owner = start.id;
    let processedCount = 0;

    for (;;) {
      // Before every new entry: the session must still belong to the queue's owner.
      if (processedCount > 0) {
        const current = await this.readCurrentUser();
        if (current.kind === 'unavailable') {
          return blocked(owner, processedCount, null, 'unavailable');
        }
        if (current.kind === 'signed-out') {
          return { kind: 'not-authenticated', ownerUserId: owner, processedCount };
        }
        if (current.id !== owner) {
          return { kind: 'session-changed', ownerUserId: owner, processedCount };
        }
      }

      // Always peek again (never a snapshot), so entries enqueued meanwhile are found.
      let mutation: QueuedOfflineMutation | null;
      try {
        mutation = await this.queue.peekOldest(owner);
      } catch (error: unknown) {
        return blocked(owner, processedCount, null, queueFailureReason(error));
      }
      if (mutation === null) return { kind: 'drained', ownerUserId: owner, processedCount };

      const outcome = await this.send(owner, mutation);
      if (outcome === 'signed-out') {
        return { kind: 'not-authenticated', ownerUserId: owner, processedCount };
      }
      if (outcome !== 'terminal') {
        return blocked(owner, processedCount, mutation.sequence, outcome);
      }

      // Removed only after a terminal remote outcome. If the app dies before this line,
      // the entry is replayed later, which is safe because both commands are idempotent:
      // PUT /post-likes sets a state, POST /post-comments replays by commentId.
      let removed: boolean;
      try {
        removed = await this.queue.remove(owner, mutation.sequence);
      } catch {
        return blocked(owner, processedCount, mutation.sequence, 'unavailable');
      }
      if (!removed) {
        return blocked(owner, processedCount, mutation.sequence, 'queue-inconsistent');
      }
      processedCount += 1;
    }
  }

  // At most one remote mutation is in flight, across ALL kinds: the loop awaits each
  // send before peeking the next entry. Dispatch only chooses the endpoint.
  private send(owner: string, mutation: QueuedOfflineMutation): Promise<SendOutcome> {
    switch (mutation.kind) {
      case SET_POST_LIKE:
        return this.sendSetPostLike(owner, mutation);
      case CREATE_POST_COMMENT:
        return this.sendCreatePostComment(owner, mutation);
      default: {
        // Unreachable: the decoder only yields known kinds.
        const unknownKind: never = mutation;
        void unknownKind;
        return Promise.resolve('corrupt-data');
      }
    }
  }

  private async sendSetPostLike(
    owner: string,
    mutation: QueuedSetPostLikeMutation,
  ): Promise<SendOutcome> {
    const { postId, liked } = mutation.payload;
    try {
      const result = await this.postLikes.setLike({ expectedOwnerUserId: owner, postId, liked });
      if (result.kind === 'profile-not-ready') return 'profile-not-ready';
      // `updated` and the contractual `not-found` both finish this command.
      return result.postId === postId ? 'terminal' : 'invalid-response';
    } catch (error: unknown) {
      return this.classifyFailure(error);
    }
  }

  private async sendCreatePostComment(
    owner: string,
    mutation: QueuedCreatePostCommentMutation,
  ): Promise<SendOutcome> {
    const { commentId, postId, parentCommentId, body } = mutation.payload;
    try {
      const result = await this.postComments.createComment({
        expectedOwnerUserId: owner, commentId, postId, parentCommentId, body,
      });
      switch (result.kind) {
        // Created now or an exact replay of an earlier send: either way it exists.
        case 'confirmed':
          return normalizeUuid(result.comment.id) === commentId ? 'terminal' : 'invalid-response';
        // The comment can never be applied (post gone or hidden, parent gone or under
        // another post): finished, so it does not block the queue forever.
        case 'post-not-found':
        case 'parent-not-found':
          return 'terminal';
        case 'profile-not-ready':
          return 'profile-not-ready';
      }
    } catch (error: unknown) {
      return this.classifyFailure(error);
    }
  }

  private async classifyFailure(error: unknown): Promise<SendOutcome> {
    if (!(error instanceof RemoteMutationError)) return 'unavailable';
    if (error.code === 'authentication-required') {
      const current = await this.readCurrentUser();
      return current.kind === 'signed-out' ? 'signed-out' : 'authentication-required';
    }
    return error.code;
  }

  private async readCurrentUser(): Promise<CurrentUserRead> {
    try {
      const id = await this.currentUser.getCurrentUserId();
      if (id === null) return { kind: 'signed-out' };
      const normalized = normalizeUuid(id);
      return normalized === null ? { kind: 'unavailable' } : { kind: 'user', id: normalized };
    } catch {
      return { kind: 'unavailable' };
    }
  }
}
