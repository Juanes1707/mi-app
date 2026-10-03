import { isFeedPageResponseDto } from '@/features/feed/data/dto/feed-page-response';
import { mapFeedPageDtoToDomain } from '@/features/feed/data/mappers/feed-page-mapper';
import { FeedError } from '@/features/feed/domain/errors/feed-error';
import type { FeedCursor, FeedPage } from '@/features/feed/domain/models/feed-page';
import type { FeedRepository } from '@/features/feed/domain/repositories/feed-repository';
import {
  AuthenticatedBackendApiClient,
  AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

export class BackendFeedRepository implements FeedRepository {
  constructor(private readonly client: AuthenticatedBackendApiClient) {}

  async getPage(cursor: FeedCursor | null = null): Promise<FeedPage> {
    try {
      const path = cursor === null ? '/feed' :
        `/feed?beforeCreatedAt=${encodeURIComponent(cursor.createdAt)}&beforePostId=${encodeURIComponent(cursor.postId)}`;
      const response = await this.client.get<unknown>(path);
      if (!isFeedPageResponseDto(response)) throw new FeedError('invalid-response');
      return mapFeedPageDtoToDomain(response);
    } catch (error: unknown) {
      if (error instanceof FeedError) throw error;
      if (error instanceof AuthenticationRequiredError) {
        throw new FeedError('authentication-required');
      }
      if (error instanceof BackendApiError) {
        if (error.status === 401) throw new FeedError('authentication-required');
        if (error.code === 'invalid-json') throw new FeedError('invalid-response');
        if (error.status === 400 || error.backendCode === 'invalid_feed_request') {
          throw new FeedError('invalid-request');
        }
      }
      throw new FeedError('unavailable');
    }
  }
}
