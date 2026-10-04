import { GetProfileConnectionsPage } from '@/features/profile-connections/application/get-profile-connections-page';
import { BackendProfileConnectionsRepository } from '@/features/profile-connections/data/backend-profile-connections-repository';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

const repository = new BackendProfileConnectionsRepository(authenticatedBackendApiClient);

export const getProfileConnectionsPage = new GetProfileConnectionsPage(repository);
