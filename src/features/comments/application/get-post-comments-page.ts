import type {
  PostCommentsPage,
  PostCommentsPageRequest,
} from '@/features/comments/domain/post-comment';
import { isUuid, parseCommentTimestamp } from '@/features/comments/domain/post-comment-values';
import { PostCommentsError } from '@/features/comments/domain/post-comments-error';
import type { PostCommentsRepository } from '@/features/comments/domain/post-comments-repository';

export const POST_COMMENTS_PAGE_SIZE = 20;
// GET /post-comments accepts 1..50.
const MAX_POST_COMMENTS_PAGE_SIZE = 50;

export class GetPostCommentsPage {
  constructor(private readonly repository: PostCommentsRepository) {}

  // A request the backend would reject never leaves the device.
  async execute(input: PostCommentsPageRequest): Promise<PostCommentsPage> {
    const limit = input.limit ?? POST_COMMENTS_PAGE_SIZE;
    const cursor = input.cursor ?? null;

    if (
      !isUuid(input.postId) ||
      (input.parentCommentId !== null && !isUuid(input.parentCommentId)) ||
      !Number.isInteger(limit) || limit < 1 || limit > MAX_POST_COMMENTS_PAGE_SIZE ||
      (cursor !== null &&
        (parseCommentTimestamp(cursor.createdAt) === null || !isUuid(cursor.commentId)))
    ) {
      throw new PostCommentsError('invalid-request');
    }

    return this.repository.getPage({
      postId: input.postId,
      parentCommentId: input.parentCommentId,
      limit,
      cursor,
    });
  }
}
