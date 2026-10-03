export const SET_POST_LIKE = 'set-post-like';
export const CREATE_POST_COMMENT = 'create-post-comment';

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

// The entity is the comment being created, identified by its client-generated UUID.
// That UUID is the backend's idempotency key: replaying the same payload after a
// crash or a lost response never creates a second comment.
export type QueuedCreatePostCommentMutation = {
  sequence: number;
  ownerUserId: string;
  kind: typeof CREATE_POST_COMMENT;
  entityKey: string;
  payloadVersion: 1;
  enqueuedAtMs: number;
  payload: {
    commentId: string;
    postId: string;
    // null for a root comment.
    parentCommentId: string | null;
    // Exactly as typed: never trimmed or normalized.
    body: string;
  };
};

// One global chronological queue: every kind shares the same `sequence`, so a like,
// a comment and an unlike replay in the order the user performed them.
export type QueuedOfflineMutation = QueuedSetPostLikeMutation | QueuedCreatePostCommentMutation;

export type EnqueueSetPostLikeInput = {
  ownerUserId: string;
  postId: string;
  liked: boolean;
};

export type EnqueueCreatePostCommentInput = {
  ownerUserId: string;
  commentId: string;
  postId: string;
  parentCommentId: string | null;
  body: string;
};
