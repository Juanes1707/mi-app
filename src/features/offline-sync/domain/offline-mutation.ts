export const SET_POST_LIKE = 'set-post-like';

// A user intention persisted for later replay. `sequence` is the ONLY ordering
// authority; `enqueuedAtMs` is diagnostic (device clocks jump, repeat and go back).
export type QueuedSetPostLikeMutation = {
  sequence: number;
  ownerUserId: string;
  kind: typeof SET_POST_LIKE;
  entityKey: string;
  payloadVersion: 1;
  enqueuedAtMs: number;
  payload: {
    postId: string;
    liked: boolean;
  };
};

// One global chronological queue: future kinds (e.g. comments) join this union
// instead of creating a second, independently ordered queue.
export type QueuedOfflineMutation = QueuedSetPostLikeMutation;

export type EnqueueSetPostLikeInput = {
  ownerUserId: string;
  postId: string;
  liked: boolean;
};
