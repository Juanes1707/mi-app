import { SET_POST_LIKE, type QueuedOfflineMutation } from './offline-mutation';

export type PostLikeDisplayState = { isLiked: boolean; likesCount: number };

// Read-only view of the queue for the UI: the LAST pending desired state per post.
// The queue itself keeps every entry (like, unlike, like) for ordered replay.
export function reducePendingPostLikes(
  mutations: readonly QueuedOfflineMutation[],
): ReadonlyMap<string, boolean> {
  const desired = new Map<string, boolean>();
  const ordered = [...mutations].sort((a, b) => a.sequence - b.sequence);
  for (const mutation of ordered) {
    if (mutation.kind === SET_POST_LIKE) desired.set(mutation.payload.postId, mutation.payload.liked);
  }
  return desired;
}

// Server read model + the user's pending desired state → what the UI shows.
// The server count already includes the server-side like, so only a pending
// TRANSITION moves the count by one; it never goes below zero.
export function projectPostLikeState(input: {
  serverLiked: boolean;
  serverLikesCount: number;
  desiredLiked: boolean | undefined;
}): PostLikeDisplayState {
  const serverLikesCount = Math.max(0, input.serverLikesCount);
  const { serverLiked, desiredLiked } = input;
  if (desiredLiked === undefined || desiredLiked === serverLiked) {
    return { isLiked: serverLiked, likesCount: serverLikesCount };
  }
  return {
    isLiked: desiredLiked,
    likesCount: desiredLiked ? serverLikesCount + 1 : Math.max(0, serverLikesCount - 1),
  };
}
