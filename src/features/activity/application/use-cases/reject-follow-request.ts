import { FollowRequestError } from '@/features/activity/domain/errors/follow-request-error';
import type { FollowRequestResolution } from '@/features/activity/domain/models/follow-request';
import type { FollowRequestRepository } from '@/features/activity/domain/repositories/follow-request-repository';

export class RejectFollowRequest {
  constructor(private readonly followRequestRepository: FollowRequestRepository) {}

  execute(requestId: string): Promise<FollowRequestResolution> {
    const normalizedRequestId = requestId.trim();

    if (!normalizedRequestId) {
      throw new FollowRequestError('invalid-request');
    }

    return this.followRequestRepository.respondToFollowRequest(
      normalizedRequestId,
      'reject',
    );
  }
}
