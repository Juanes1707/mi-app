import { SearchProfiles } from '@/features/explore/application/use-cases/search-profiles';
import { BackendProfileSearchRepository } from '@/features/explore/data/repositories/backend-profile-search-repository';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

const profileSearchRepository = new BackendProfileSearchRepository(
  authenticatedBackendApiClient,
);

export const searchProfiles = new SearchProfiles(profileSearchRepository);
