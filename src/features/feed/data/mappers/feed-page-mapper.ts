import type { FeedPageResponseDto } from '@/features/feed/data/dto/feed-page-response';
import type { FeedPage } from '@/features/feed/domain/models/feed-page';

export function mapFeedPageDtoToDomain(dto: FeedPageResponseDto): FeedPage {
  return {
    posts: dto.posts.map((post) => ({
      id: post.id,
      author: {
        id: post.author.id,
        username: post.author.username,
        displayName: post.author.displayName,
      },
      imagePath: post.imagePath,
      caption: post.caption,
      createdAt: post.createdAt,
      likesCount: post.likesCount,
      commentsCount: post.commentsCount,
      isLiked: post.isLiked,
    })),
    nextCursor: dto.nextCursor === null ? null : {
      createdAt: dto.nextCursor.createdAt,
      postId: dto.nextCursor.postId,
    },
  };
}
