import { AcceptFollowRequest } from '@/features/activity/application/use-cases/accept-follow-request';
import { GetPendingFollowRequests } from '@/features/activity/application/use-cases/get-pending-follow-requests';
import { RejectFollowRequest } from '@/features/activity/application/use-cases/reject-follow-request';
import { BackendFollowRequestRepository } from '@/features/activity/data/repositories/backend-follow-request-repository';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

const followRequestRepository = new BackendFollowRequestRepository(
  authenticatedBackendApiClient,
);

export const getPendingFollowRequests = new GetPendingFollowRequests(
  followRequestRepository,
);
export const acceptFollowRequest = new AcceptFollowRequest(followRequestRepository);
export const rejectFollowRequest = new RejectFollowRequest(followRequestRepository);
