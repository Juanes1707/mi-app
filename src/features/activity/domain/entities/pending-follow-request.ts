export type PendingFollowRequest = {
  id: string;
  requester: {
    id: string;
    username: string | null;
    displayName: string | null;
  };
  createdAt: string;
};
