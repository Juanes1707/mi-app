import type {
  PostCommentsPage,
  PostCommentsPageRequest,
} from '@/features/comments/domain/post-comment';

// Read-only for now: comment creation from mobile is not part of this feature yet.
export interface PostCommentsRepository {
  getPage(request: PostCommentsPageRequest): Promise<PostCommentsPage>;
}
