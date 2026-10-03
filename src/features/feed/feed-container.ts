import { GetFeedPage } from '@/features/feed/application/use-cases/get-feed-page';
import { BackendFeedRepository } from '@/features/feed/data/repositories/backend-feed-repository';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

const feedRepository = new BackendFeedRepository(authenticatedBackendApiClient);
export const getFeedPage = new GetFeedPage(feedRepository);
