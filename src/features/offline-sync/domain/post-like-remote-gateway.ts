// Outcomes the backend can authoritatively report for one set-like command.
// `not-found` deliberately covers "deleted" and "no longer visible" alike.
// `rejected`: the contractual 400; the backend will never accept this command.
export type SetPostLikeRemoteResult =
  | { kind: 'updated'; postId: string; liked: boolean; likesCount: number }
  | { kind: 'not-found'; postId: string }
  | { kind: 'rejected'; postId: string }
  | { kind: 'profile-not-ready' };

export type SetPostLikeRemoteInput = {
  // Local guard only: the request must be sent with THIS user's session. It is never
  // sent to the backend, which always takes the actor from the verified JWT.
  expectedOwnerUserId: string;
  postId: string;
  liked: boolean;
};

export interface PostLikeRemoteGateway {
  setLike(input: SetPostLikeRemoteInput): Promise<SetPostLikeRemoteResult>;
}
