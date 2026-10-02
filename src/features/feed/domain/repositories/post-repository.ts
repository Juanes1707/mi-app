import type { Post } from '@/features/feed/domain/entities/post';

export interface PostRepository {
  getFeedPosts(): Promise<Post[]>;
}
