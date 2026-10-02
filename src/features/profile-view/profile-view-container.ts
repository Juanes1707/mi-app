import { GetProfileView } from '@/features/profile-view/application/use-cases/get-profile-view';
import { BackendProfileViewRepository } from '@/features/profile-view/data/repositories/backend-profile-view-repository';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

const profileViewRepository = new BackendProfileViewRepository(
  authenticatedBackendApiClient,
);

export const getProfileView = new GetProfileView(profileViewRepository);
