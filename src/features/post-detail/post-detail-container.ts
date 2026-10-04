import { GetPost } from '@/features/post-detail/application/get-post';
import { BackendPostDetailRepository } from '@/features/post-detail/data/backend-post-detail-repository';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

const postDetailRepository = new BackendPostDetailRepository(authenticatedBackendApiClient);
export const getPost = new GetPost(postDetailRepository);
