export type CreatedPostComment = {
  id: string;
  postId: string;
  parentCommentId: string | null;
  authorId: string;
  body: string;
  createdAt: string;
};

// Outcomes the backend can authoritatively report for one create-comment command.
// `confirmed` covers both the first creation and an exact idempotent replay.
// `post-not-found` deliberately covers "deleted" and "no longer visible" alike.
export type CreatePostCommentRemoteResult =
  | { kind: 'confirmed'; comment: CreatedPostComment }
  | { kind: 'post-not-found' }
  | { kind: 'parent-not-found' }
  | { kind: 'profile-not-ready' };

export type CreatePostCommentRemoteInput = {
  // Local guard only: the request must be sent with THIS user's session. It is never
  // sent to the backend, which always takes the author from the verified JWT.
  expectedOwnerUserId: string;
  commentId: string;
  postId: string;
  parentCommentId: string | null;
  body: string;
};

export interface PostCommentRemoteGateway {
  createComment(input: CreatePostCommentRemoteInput): Promise<CreatePostCommentRemoteResult>;
}
