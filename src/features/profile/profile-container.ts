import { GetMyProfile } from '@/features/profile/application/use-cases/get-my-profile';
import { UpdateMyProfile } from '@/features/profile/application/use-cases/update-my-profile';
import { BackendProfileRepository } from '@/features/profile/data/repositories/backend-profile-repository';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

const profileRepository = new BackendProfileRepository(authenticatedBackendApiClient);

export const getMyProfile = new GetMyProfile(profileRepository);
export const updateMyProfile = new UpdateMyProfile(profileRepository);
