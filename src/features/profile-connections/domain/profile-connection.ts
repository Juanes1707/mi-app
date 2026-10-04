export type ProfileConnectionKind = 'followers' | 'following';

export type ProfileConnection = {
  id: string;
  username: string | null;
  displayName: string | null;
  isPrivate: boolean;
  // Pagination metadata from the follow relationship; never rendered as profile data.
  connectedAt: string;
};

export type ProfileConnectionsCursor = {
  connectedAt: string;
  userId: string;
};

export type ProfileConnectionsPage = {
  connections: ProfileConnection[];
  nextCursor: ProfileConnectionsCursor | null;
};
