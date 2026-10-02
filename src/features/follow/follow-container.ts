import { RequestFollow } from '@/features/follow/application/use-cases/request-follow';
import { BackendFollowRepository } from '@/features/follow/data/repositories/backend-follow-repository';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

const followRepository = new BackendFollowRepository(authenticatedBackendApiClient);

export const requestFollow = new RequestFollow(followRepository);
