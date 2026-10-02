import type { PendingFollowRequest } from '@/features/activity/domain/entities/pending-follow-request';
import type { FollowRequestRepository } from '@/features/activity/domain/repositories/follow-request-repository';

export class GetPendingFollowRequests {
  constructor(private readonly followRequestRepository: FollowRequestRepository) {}

  execute(): Promise<PendingFollowRequest[]> {
    return this.followRequestRepository.getPendingFollowRequests();
  }
}
