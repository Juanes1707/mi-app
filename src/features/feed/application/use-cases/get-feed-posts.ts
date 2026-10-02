import type { Post } from '@/features/feed/domain/entities/post';
import type { PostRepository } from '@/features/feed/domain/repositories/post-repository';

export class GetFeedPosts {
  constructor(private readonly repository: PostRepository) {}

  execute(): Promise<Post[]> {
    return this.repository.getFeedPosts();
  }
}
