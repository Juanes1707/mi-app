import type { FeedPost } from '@/features/feed/domain/entities/feed-post';
import { PostDetailError } from '@/features/post-detail/domain/post-detail-error';
import type { PostDetailRepository } from '@/features/post-detail/domain/post-detail-repository';
import { normalizeUuid } from '@/shared/domain/uuid';

export class GetPost {
  constructor(private readonly repository: PostDetailRepository) {}

  execute(postId: string): Promise<FeedPost> {
    const normalizedPostId = normalizeUuid(postId);

    if (normalizedPostId === null) {
      throw new PostDetailError('invalid-request');
    }

    return this.repository.getPost(normalizedPostId);
  }
}
