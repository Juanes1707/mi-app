import { isProfileViewResponseDto } from '@/features/profile-view/data/dto/profile-view-response';
import { mapProfileViewResponseDtoToDomain } from '@/features/profile-view/data/mappers/profile-view-mapper';
import type { ViewedProfile } from '@/features/profile-view/domain/entities/viewed-profile';
import { ProfileViewError } from '@/features/profile-view/domain/errors/profile-view-error';
import type { ProfileViewRepository } from '@/features/profile-view/domain/repositories/profile-view-repository';
import {
  AuthenticatedBackendApiClient,
  AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

export class BackendProfileViewRepository implements ProfileViewRepository {
  constructor(private readonly authenticatedBackendApiClient: AuthenticatedBackendApiClient) {}

  async getProfileById(profileId: string): Promise<ViewedProfile> {
    try {
      const encodedProfileId = encodeURIComponent(profileId);
      const response = await this.authenticatedBackendApiClient.get<unknown>(
        `/profiles?profileId=${encodedProfileId}`,
      );

      if (!isProfileViewResponseDto(response)) {
        throw new ProfileViewError('invalid-response');
      }

      return mapProfileViewResponseDtoToDomain(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): ProfileViewError {
    if (error instanceof ProfileViewError) {
      return error;
    }

    if (error instanceof AuthenticationRequiredError) {
      return new ProfileViewError('authentication-required');
    }

    if (error instanceof BackendApiError) {
      if (error.code === 'invalid-json') {
        return new ProfileViewError('invalid-response');
      }

      if (error.backendCode === 'invalid_profile_request') {
        return new ProfileViewError('invalid-request');
      }

      if (error.backendCode === 'profile_not_found') {
        return new ProfileViewError('profile-not-found');
      }

      if (error.backendCode === 'profile_read_failed') {
        return new ProfileViewError('unavailable');
      }

      if (error.status === 401) {
        return new ProfileViewError('authentication-required');
      }

      if (error.status === 400) {
        return new ProfileViewError('invalid-request');
      }

      if (error.status === 404) {
        return new ProfileViewError('profile-not-found');
      }
    }

    return new ProfileViewError('unavailable');
  }
}
