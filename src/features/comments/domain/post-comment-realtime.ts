// A live INVALIDATION HINT, not a comment: "post P has a new comment C". It carries no
// content, so it grants nothing; the comment is always re-read through the authorized
// HTTP read model before it is shown.
export type PostCommentCreatedEvent = {
  postId: string;
  commentId: string;
};

export type PostCommentRealtimeStatus = 'subscribed' | 'channel-error' | 'timed-out' | 'closed';

export type PostCommentRealtimeErrorCode =
  | 'invalid-request'
  | 'authentication-required'
  | 'owner-session-mismatch'
  | 'unavailable';

export class PostCommentRealtimeError extends Error {
  constructor(readonly code: PostCommentRealtimeErrorCode) {
    super(`Post comment realtime failed: ${code}.`);
    this.name = 'PostCommentRealtimeError';
  }
}

export type PostCommentRealtimeSubscription = {
  // Idempotent: the channel is removed once; no callback runs afterwards.
  unsubscribe(): Promise<void>;
};

// Receive-only live source of new-comment hints for one post, joined with the session
// of the expected owner (refused otherwise). Transport details stay in the data layer.
export interface PostCommentRealtimeSource {
  subscribe(input: {
    expectedOwnerUserId: string;
    postId: string;
    onCommentCreated(event: PostCommentCreatedEvent): void;
    onStatus?(status: PostCommentRealtimeStatus): void;
  }): Promise<PostCommentRealtimeSubscription>;
}
