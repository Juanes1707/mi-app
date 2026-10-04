import type { FeedPost } from '@/features/feed/domain/entities/feed-post';

export interface PostDetailRepository {
  getPost(postId: string): Promise<FeedPost>;
}
