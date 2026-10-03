import type { PostMediaInput, PublishPostInput } from '@/features/post-create/domain/models';
import type { PostPublishingRepository } from '@/features/post-create/domain/ports';
import { PostCreateError } from '@/features/post-create/domain/post-create-error';
import { parsePublishedPost, parseUploadTicket } from './post-create-response';
import {
  AuthenticatedBackendApiClient, AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

export class BackendPostPublishingRepository implements PostPublishingRepository {
  constructor(private readonly client: AuthenticatedBackendApiClient) {}

  async prepareUpload(input: PostMediaInput) {
    try {
      const response = await this.client.post<unknown, PostMediaInput>(
        '/post-media-upload', { contentType: input.contentType, fileSize: input.fileSize },
      );
      return parseUploadTicket(response);
    } catch (error: unknown) {
      throw mapError(error, 'prepare');
    }
  }
  async publish(input: PublishPostInput) {
    try {
      const response = await this.client.post<unknown, PublishPostInput>(
        '/posts', { imagePath: input.imagePath, caption: input.caption },
      );
      return parsePublishedPost(response, input.imagePath);
    } catch (error: unknown) {
      throw mapError(error, 'publish');
    }
  }
}

function mapError(error: unknown, operation: 'prepare' | 'publish'): PostCreateError {
  if (error instanceof PostCreateError) return error;
  if (error instanceof AuthenticationRequiredError) return new PostCreateError('authentication-required');
  if (error instanceof BackendApiError) {
    if (error.status === 401) return new PostCreateError('authentication-required');
    if (error.code === 'invalid-json') return new PostCreateError('invalid-response');
    if (error.backendCode === 'post_media_not_ready') return new PostCreateError('media-not-ready');
    if (error.backendCode === 'profile_not_ready') return new PostCreateError('profile-not-ready');
    if (error.status === 400) {
      return new PostCreateError(operation === 'prepare' ? 'invalid-image' : 'invalid-request');
    }
  }
  return new PostCreateError('unavailable');
}
