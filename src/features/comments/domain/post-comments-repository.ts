import type {
  PostComment,
  PostCommentRequest,
  PostCommentsPage,
  PostCommentsPageRequest,
} from '@/features/comments/domain/post-comment';

// Read-only: comments are created through the offline-sync queue, never from here.
export interface PostCommentsRepository {
  getPage(request: PostCommentsPageRequest): Promise<PostCommentsPage>;
  // The authorized, canonical version of one comment (e.g. after a Realtime hint).
  getComment(request: PostCommentRequest): Promise<PostComment>;
}
