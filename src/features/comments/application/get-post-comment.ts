import type { PostComment, PostCommentRequest } from '@/features/comments/domain/post-comment';
import { isUuid } from '@/features/comments/domain/post-comment-values';
import { PostCommentsError } from '@/features/comments/domain/post-comments-error';
import type { PostCommentsRepository } from '@/features/comments/domain/post-comments-repository';

// The canonical, authorized version of one comment. Used after a Realtime hint: the
// hint is never trusted as content.
export class GetPostComment {
  constructor(private readonly repository: PostCommentsRepository) {}

  async execute(input: PostCommentRequest): Promise<PostComment> {
    if (!isUuid(input.expectedOwnerUserId) || !isUuid(input.postId) || !isUuid(input.commentId)) {
      throw new PostCommentsError('invalid-request');
    }
    return this.repository.getComment({
      expectedOwnerUserId: input.expectedOwnerUserId.toLowerCase(),
      postId: input.postId.toLowerCase(),
      commentId: input.commentId.toLowerCase(),
    });
  }
}
