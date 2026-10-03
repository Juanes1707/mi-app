import { GetPostCommentsPage } from '@/features/comments/application/get-post-comments-page';
import { BackendPostCommentsRepository } from '@/features/comments/data/backend-post-comments-repository';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

const postCommentsRepository = new BackendPostCommentsRepository(authenticatedBackendApiClient);
export const getPostCommentsPage = new GetPostCommentsPage(postCommentsRepository);
