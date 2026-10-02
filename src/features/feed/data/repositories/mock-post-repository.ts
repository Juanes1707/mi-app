import { MOCK_POSTS } from '@/features/feed/data/mocks/mock-posts';
import type { Post } from '@/features/feed/domain/entities/post';
import type { PostRepository } from '@/features/feed/domain/repositories/post-repository';

export class MockPostRepository implements PostRepository {
  async getFeedPosts(): Promise<Post[]> {
    return MOCK_POSTS.map((post) => ({
      ...post,
      author: { ...post.author },
    }));
  }
}
