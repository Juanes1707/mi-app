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
// `rejected`: the contractual 400; the backend will never accept this payload.
// `conflict`: the comment UUID already exists with another payload or author. The
// backend keeps that row untouched, so this command can never be applied.
export type CreatePostCommentRemoteResult =
  | { kind: 'confirmed'; comment: CreatedPostComment }
  | { kind: 'post-not-found' }
  | { kind: 'parent-not-found' }
  | { kind: 'rejected' }
  | { kind: 'conflict' }
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
