export type FeedPost = {
  id: string;
  author: { id: string; username: string | null; displayName: string | null };
  imagePath: string;
  caption: string;
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
};
