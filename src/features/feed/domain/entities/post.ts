export type Post = {
  id: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
  };
  imageUrl: string;
  caption: string;
  createdAt: string;
  likeCount: number;
  commentCount: number;
};
