import type { PendingFollowRequest } from '@/features/activity/domain/entities/pending-follow-request';
import type {
  FollowRequestDecision,
  FollowRequestResolution,
} from '@/features/activity/domain/models/follow-request';

export interface FollowRequestRepository {
  getPendingFollowRequests(): Promise<PendingFollowRequest[]>;
  respondToFollowRequest(
    requestId: string,
    decision: FollowRequestDecision,
  ): Promise<FollowRequestResolution>;
}
