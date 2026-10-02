import { isProfileSearchResponseDto } from '@/features/explore/data/dto/profile-search-response';
import { mapProfileSearchResponseDtoToDomain } from '@/features/explore/data/mappers/profile-search-mapper';
import type { DiscoveredProfile } from '@/features/explore/domain/entities/discovered-profile';
import { ProfileSearchError } from '@/features/explore/domain/errors/profile-search-error';
import type { ProfileSearchRepository } from '@/features/explore/domain/repositories/profile-search-repository';
import {
  AuthenticatedBackendApiClient,
  AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

export class BackendProfileSearchRepository implements ProfileSearchRepository {
  constructor(private readonly authenticatedBackendApiClient: AuthenticatedBackendApiClient) {}

  async searchProfiles(query: string): Promise<DiscoveredProfile[]> {
    try {
      const response = await this.authenticatedBackendApiClient.get<unknown>(
        `/profile-search?query=${encodeURIComponent(query)}`,
      );

      if (!isProfileSearchResponseDto(response)) {
        throw new ProfileSearchError('invalid-response');
      }

      return mapProfileSearchResponseDtoToDomain(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  private mapError(error: unknown): ProfileSearchError {
    if (error instanceof ProfileSearchError) {
      return error;
    }

    if (error instanceof AuthenticationRequiredError) {
      return new ProfileSearchError('authentication-required');
    }

    if (error instanceof BackendApiError) {
      if (error.status === 401) {
        return new ProfileSearchError('authentication-required');
      }

      if (error.code === 'invalid-json') {
        return new ProfileSearchError('invalid-response');
      }

      if (error.status === 400 || error.backendCode === 'invalid_profile_search') {
        return new ProfileSearchError('invalid-query');
      }
    }

    return new ProfileSearchError('unavailable');
  }
}
