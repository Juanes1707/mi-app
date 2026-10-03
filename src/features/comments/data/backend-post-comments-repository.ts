import { parsePostCommentsPage } from '@/features/comments/data/post-comments-response';
import type {
  PostCommentsPage,
  PostCommentsPageRequest,
} from '@/features/comments/domain/post-comment';
import { PostCommentsError } from '@/features/comments/domain/post-comments-error';
import type { PostCommentsRepository } from '@/features/comments/domain/post-comments-repository';
import {
  AuthenticatedBackendApiClient,
  AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

// What GET /post-comments uses when the limit parameter is omitted.
const BACKEND_DEFAULT_LIMIT = 20;

// URLSearchParams percent-encodes every value: a cursor such as
// 2026-10-03T10:00:00+00:00 travels as ...10%3A00%3A00%2B00%3A00. A raw "+" would
// be decoded by the server as a space. Root pages OMIT parentCommentId entirely.
export function buildPostCommentsPath(request: PostCommentsPageRequest): string {
  const params = new URLSearchParams();
  params.set('postId', request.postId);
  if (request.parentCommentId !== null) params.set('parentCommentId', request.parentCommentId);
  if (request.limit !== undefined) params.set('limit', String(request.limit));
  if (request.cursor) {
    params.set('afterCreatedAt', request.cursor.createdAt);
    params.set('afterCommentId', request.cursor.commentId);
  }
  return `/post-comments?${params.toString()}`;
}

export class BackendPostCommentsRepository implements PostCommentsRepository {
  constructor(private readonly client: AuthenticatedBackendApiClient) {}

  async getPage(request: PostCommentsPageRequest): Promise<PostCommentsPage> {
    let response: unknown;
    try {
      response = await this.client.get<unknown>(buildPostCommentsPath(request));
    } catch (error: unknown) {
      throw toPostCommentsError(error);
    }

    const page = parsePostCommentsPage(response, {
      postId: request.postId,
      parentCommentId: request.parentCommentId,
      limit: request.limit ?? BACKEND_DEFAULT_LIMIT,
      cursor: request.cursor ?? null,
    });
    if (page === null) throw new PostCommentsError('invalid-response');
    return page;
  }
}

// Only the contractual (status, code) pairs get a specific meaning; any other
// failure, including an unexpected 404, is "unavailable".
function toPostCommentsError(error: unknown): PostCommentsError {
  if (error instanceof AuthenticationRequiredError) {
    return new PostCommentsError('authentication-required');
  }
  if (!(error instanceof BackendApiError)) return new PostCommentsError('unavailable');
  // A 2xx whose body is not JSON: the server answered, but off-contract.
  if (error.code === 'invalid-json') return new PostCommentsError('invalid-response');
  if (error.code !== 'http') return new PostCommentsError('unavailable');

  if (error.status === 401) return new PostCommentsError('authentication-required');
  if (error.status === 400 && error.backendCode === 'invalid_post_comments_request') {
    return new PostCommentsError('invalid-request');
  }
  if (error.status === 404 && error.backendCode === 'post_not_found') {
    return new PostCommentsError('post-not-found');
  }
  if (error.status === 404 && error.backendCode === 'parent_comment_not_found') {
    return new PostCommentsError('parent-not-found');
  }
  if (error.status === 409 && error.backendCode === 'profile_not_ready') {
    return new PostCommentsError('profile-not-ready');
  }
  return new PostCommentsError('unavailable');
}
