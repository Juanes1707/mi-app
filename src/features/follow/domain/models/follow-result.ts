export type FollowResult =
  | {
      status: 'following';
    }
  | {
      status: 'request-pending';
      requestId: string;
    };
