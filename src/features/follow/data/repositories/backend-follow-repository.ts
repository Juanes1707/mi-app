import {
  mapRequestFollowToRequestDto,
  type RequestFollowRequestDto,
} from '@/features/follow/data/dto/request-follow-request';
import { isRequestFollowResponseDto } from '@/features/follow/data/dto/request-follow-response';
import { mapRequestFollowResponseDtoToDomain } from '@/features/follow/data/mappers/follow-mapper';
import { FollowError } from '@/features/follow/domain/errors/follow-error';
import type { FollowResult } from '@/features/follow/domain/models/follow-result';
import type { FollowRepository } from '@/features/follow/domain/repositories/follow-repository';
import {
  AuthenticatedBackendApiClient,
  AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

export class BackendFollowRepository implements FollowRepository {
  constructor(private readonly authenticatedBackendApiClient: AuthenticatedBackendApiClient) {}

  async requestFollow(targetProfileId: string): Promise<FollowResult> {
    try {
      const request = mapRequestFollowToRequestDto(targetProfileId);
      const response = await this.authenticatedBackendApiClient.post<
        unknown,
        RequestFollowRequestDto
      >('/follow', request);

      if (!isRequestFollowResponseDto(response)) {
        throw new FollowError('invalid-response');
      }

      return mapRequestFollowResponseDtoToDomain(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): FollowError {
    if (error instanceof FollowError) {
      return error;
    }

    if (error instanceof AuthenticationRequiredError) {
      return new FollowError('authentication-required');
    }

    if (error instanceof BackendApiError) {
      if (error.code === 'invalid-json') {
        return new FollowError('invalid-response');
      }

      if (error.backendCode === 'cannot_follow_self') {
        return new FollowError('cannot-follow-self');
      }

      if (
        error.backendCode === 'invalid_json' ||
        error.backendCode === 'invalid_follow_request'
      ) {
        return new FollowError('invalid-request');
      }

      if (error.backendCode === 'profile_not_found') {
        return new FollowError('profile-not-found');
      }

      if (error.backendCode === 'profile_not_ready') {
        return new FollowError('profile-not-ready');
      }

      if (error.backendCode === 'follow_failed') {
        return new FollowError('unavailable');
      }

      if (error.status === 401) {
        return new FollowError('authentication-required');
      }

      if (error.status === 400) {
        return new FollowError('invalid-request');
      }

      if (error.status === 404) {
        return new FollowError('profile-not-found');
      }

      if (error.status === 409) {
        return new FollowError('profile-not-ready');
      }
    }

    return new FollowError('unavailable');
  }
}
