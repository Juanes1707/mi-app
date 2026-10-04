import type { FeedPost } from '@/features/feed/domain/entities/feed-post';
import { parsePostDetailResponse } from '@/features/post-detail/data/post-detail-response';
import { PostDetailError } from '@/features/post-detail/domain/post-detail-error';
import type { PostDetailRepository } from '@/features/post-detail/domain/post-detail-repository';
import {
  AuthenticatedBackendApiClient,
  AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

export function buildPostDetailPath(postId: string): string {
  const params = new URLSearchParams();
  params.set('postId', postId);
  return `/posts?${params.toString()}`;
}

export class BackendPostDetailRepository implements PostDetailRepository {
  constructor(private readonly client: AuthenticatedBackendApiClient) {}

  async getPost(postId: string): Promise<FeedPost> {
    let response: unknown;

    try {
      response = await this.client.get<unknown>(buildPostDetailPath(postId));
    } catch (error: unknown) {
      throw mapPostDetailError(error);
    }

    const post = parsePostDetailResponse(response, postId);
    if (post === null) throw new PostDetailError('invalid-response');
    return post;
  }
}

function mapPostDetailError(error: unknown): PostDetailError {
  if (error instanceof AuthenticationRequiredError) {
    return new PostDetailError('authentication-required');
  }
  if (!(error instanceof BackendApiError)) return new PostDetailError('unavailable');
  if (error.code === 'invalid-json') return new PostDetailError('invalid-response');
  if (error.code !== 'http') return new PostDetailError('unavailable');
  if (error.status === 401) return new PostDetailError('authentication-required');
  if (error.status === 400 && error.backendCode === 'invalid_post_request') {
    return new PostDetailError('invalid-request');
  }
  if (error.status === 404 && error.backendCode === 'post_not_found') {
    return new PostDetailError('post-not-found');
  }
  if (error.status === 409 && error.backendCode === 'profile_not_ready') {
    return new PostDetailError('profile-not-ready');
  }
  return new PostDetailError('unavailable');
}
