import {
  parsePostCommentsPage, parseSinglePostComment,
} from '@/features/comments/data/post-comments-response';
import type {
  PostComment,
  PostCommentRequest,
  PostCommentsPage,
  PostCommentsPageRequest,
} from '@/features/comments/domain/post-comment';
import { PostCommentsError } from '@/features/comments/domain/post-comments-error';
import type { PostCommentsRepository } from '@/features/comments/domain/post-comments-repository';
import {
  AuthenticatedBackendApiClient,
  AuthenticatedUserMismatchError,
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

// Exactly the two parameters GET /post-comment accepts.
export function buildPostCommentPath(postId: string, commentId: string): string {
  const params = new URLSearchParams();
  params.set('postId', postId);
  params.set('commentId', commentId);
  return `/post-comment?${params.toString()}`;
}

export class BackendPostCommentsRepository implements PostCommentsRepository {
  constructor(private readonly client: AuthenticatedBackendApiClient) {}

  async getPage(request: PostCommentsPageRequest): Promise<PostCommentsPage> {
    let response: unknown;
    try {
      response = await this.client.get<unknown>(buildPostCommentsPath(request));
    } catch (error: unknown) {
      throw toPostCommentsError(error, 'page');
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

  // Bound to the expected owner: the token whose subject was checked is the one sent,
  // so a session switch between a Realtime hint and this read cannot leak into it.
  async getComment(request: PostCommentRequest): Promise<PostComment> {
    let response: unknown;
    try {
      response = await this.client.getAsUser<unknown>(
        request.expectedOwnerUserId, buildPostCommentPath(request.postId, request.commentId),
      );
    } catch (error: unknown) {
      throw toPostCommentsError(error, 'single');
    }

    const comment = parseSinglePostComment(response, { postId: request.postId, commentId: request.commentId });
    if (comment === null) throw new PostCommentsError('invalid-response');
    return comment;
  }
}

// Only the contractual (status, code) pairs of each endpoint get a specific meaning;
// any other failure, including an unexpected 404, is "unavailable".
function toPostCommentsError(error: unknown, endpoint: 'page' | 'single'): PostCommentsError {
  if (error instanceof AuthenticatedUserMismatchError) {
    return new PostCommentsError('owner-session-mismatch');
  }
  if (error instanceof AuthenticationRequiredError) {
    return new PostCommentsError('authentication-required');
  }
  if (!(error instanceof BackendApiError)) return new PostCommentsError('unavailable');
  // A 2xx whose body is not JSON: the server answered, but off-contract.
  if (error.code === 'invalid-json') return new PostCommentsError('invalid-response');
  if (error.code !== 'http') return new PostCommentsError('unavailable');

  const invalidRequestCode = endpoint === 'page' ? 'invalid_post_comments_request' : 'invalid_post_comment_request';
  if (error.status === 401) return new PostCommentsError('authentication-required');
  if (error.status === 400 && error.backendCode === invalidRequestCode) {
    return new PostCommentsError('invalid-request');
  }
  if (error.status === 404 && error.backendCode === 'post_not_found') {
    return new PostCommentsError('post-not-found');
  }
  if (endpoint === 'page' && error.status === 404 && error.backendCode === 'parent_comment_not_found') {
    return new PostCommentsError('parent-not-found');
  }
  if (endpoint === 'single' && error.status === 404 && error.backendCode === 'post_comment_not_found') {
    return new PostCommentsError('comment-not-found');
  }
  if (error.status === 409 && error.backendCode === 'profile_not_ready') {
    return new PostCommentsError('profile-not-ready');
  }
  return new PostCommentsError('unavailable');
}
