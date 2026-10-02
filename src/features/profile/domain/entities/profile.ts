export type Profile = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
};
