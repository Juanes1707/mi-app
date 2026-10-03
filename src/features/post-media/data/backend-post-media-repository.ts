import { parseAuthorizedPostMedia } from './post-media-read-response';
import type { AuthorizedPostMedia } from '@/features/post-media/domain/authorized-post-media';
import { PostMediaError } from '@/features/post-media/domain/post-media-error';
import type { PostMediaRepository } from '@/features/post-media/domain/post-media-repository';
import {
  AuthenticatedBackendApiClient, AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

export class BackendPostMediaRepository implements PostMediaRepository {
  constructor(private readonly client: AuthenticatedBackendApiClient) {}

  async authorizeRead(imagePath: string): Promise<AuthorizedPostMedia> {
    try {
      const response = await this.client.get<unknown>(
        `/post-media-read?imagePath=${encodeURIComponent(imagePath)}`,
      );
      return parseAuthorizedPostMedia(response, imagePath);
    } catch (error: unknown) {
      throw mapError(error);
    }
  }
}

function mapError(error: unknown): PostMediaError {
  if (error instanceof PostMediaError) return error;
  if (error instanceof AuthenticationRequiredError) return new PostMediaError('authentication-required');
  if (error instanceof BackendApiError) {
    if (error.status === 401) return new PostMediaError('authentication-required');
    if (error.code === 'invalid-json') return new PostMediaError('invalid-response');
    if (error.status === 400) return new PostMediaError('invalid-request');
    // Only the contract's own 404 may purge the local cache; a gateway 404
    // (e.g. a function that is not deployed) is an outage, not a revocation.
    if (error.status === 404 && error.backendCode === 'post_media_not_found') {
      return new PostMediaError('not-found');
    }
  }
  return new PostMediaError('unavailable');
}
