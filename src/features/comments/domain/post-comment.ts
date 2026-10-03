export type PostCommentAuthor = {
  id: string;
  // A profile may not have chosen a username yet; the read model returns null then.
  username: string | null;
  displayName: string | null;
};

export type PostComment = {
  id: string;
  postId: string;
  // null for a root comment, otherwise the DIRECT parent.
  parentCommentId: string | null;
  author: PostCommentAuthor;
  body: string;
  createdAt: string;
  // Authoritative server count of direct replies. It is NOT the number of replies
  // loaded on this device, which may be smaller while pages remain.
  directRepliesCount: number;
};

// Position of the last comment of a page in (createdAt, id) ascending order.
export type PostCommentsCursor = {
  createdAt: string;
  commentId: string;
};

export type PostCommentsPage = {
  comments: PostComment[];
  nextCursor: PostCommentsCursor | null;
};

// One sibling set: the roots of a post (parentCommentId null) or the direct
// replies of one comment. Deeper levels are separate requests.
// One comment, read for (and only with the session of) the expected owner.
export type PostCommentRequest = {
  expectedOwnerUserId: string;
  postId: string;
  commentId: string;
};

export type PostCommentsPageRequest = {
  postId: string;
  parentCommentId: string | null;
  limit?: number;
  cursor?: PostCommentsCursor | null;
};
