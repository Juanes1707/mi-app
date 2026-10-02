import {
  isProfileMeResponseDto,
} from '@/features/profile/data/dto/profile-me-response';
import {
  mapProfileUpdateToRequestDto,
  type UpdateProfileRequestDto,
} from '@/features/profile/data/dto/update-profile-request';
import { mapProfileDtoToDomain } from '@/features/profile/data/mappers/profile-mapper';
import type { Profile } from '@/features/profile/domain/entities/profile';
import { ProfileError } from '@/features/profile/domain/errors/profile-error';
import type { ProfileUpdate } from '@/features/profile/domain/models/profile-update';
import type { ProfileRepository } from '@/features/profile/domain/repositories/profile-repository';
import {
  AuthenticatedBackendApiClient,
  AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

export class BackendProfileRepository implements ProfileRepository {
  constructor(private readonly authenticatedBackendApiClient: AuthenticatedBackendApiClient) {}

  async getMyProfile(): Promise<Profile> {
    try {
      const response = await this.authenticatedBackendApiClient.get<unknown>('/profile-me');

      return this.mapResponse(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  async updateMyProfile(update: ProfileUpdate): Promise<Profile> {
    try {
      const request = mapProfileUpdateToRequestDto(update);
      const response = await this.authenticatedBackendApiClient.patch<
        unknown,
        UpdateProfileRequestDto
      >('/profile-me', request);

      return this.mapResponse(response);
    } catch (error: unknown) {
      throw this.mapError(error);
    }
  }

  private mapResponse(response: unknown): Profile {
    if (!isProfileMeResponseDto(response)) {
      throw new ProfileError('invalid-response');
    }

    return mapProfileDtoToDomain(response.profile);
  }

  private mapError(error: unknown): ProfileError {
    if (error instanceof ProfileError) {
      return error;
    }

    if (error instanceof AuthenticationRequiredError) {
      return new ProfileError('authentication-required');
    }

    if (error instanceof BackendApiError) {
      if (error.backendCode === 'username_taken' || error.status === 409) {
        return new ProfileError('username-taken');
      }

      if (
        error.status === 400 ||
        (error.backendCode !== undefined &&
          PROFILE_UPDATE_VALIDATION_CODES.has(error.backendCode))
      ) {
        return new ProfileError('invalid-update');
      }

      if (error.code === 'invalid-json') {
        return new ProfileError('invalid-response');
      }

      if (error.code === 'http' && error.status === 401) {
        return new ProfileError('authentication-required');
      }

      if (error.code === 'http' && error.status === 404) {
        return new ProfileError('profile-not-found');
      }
    }

    return new ProfileError('unavailable');
  }
}

const PROFILE_UPDATE_VALIDATION_CODES = new Set([
  'invalid_profile_update',
  'empty_profile_update',
  'invalid_json',
  'invalid_username',
  'invalid_display_name',
  'invalid_bio',
  'invalid_privacy',
]);
