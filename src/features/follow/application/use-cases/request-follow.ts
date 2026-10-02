import { FollowError } from '@/features/follow/domain/errors/follow-error';
import type { FollowResult } from '@/features/follow/domain/models/follow-result';
import type { FollowRepository } from '@/features/follow/domain/repositories/follow-repository';

export class RequestFollow {
  constructor(private readonly followRepository: FollowRepository) {}

  execute(targetProfileId: string): Promise<FollowResult> {
    const normalizedTargetProfileId = targetProfileId.trim();

    if (!normalizedTargetProfileId) {
      throw new FollowError('invalid-request');
    }

    return this.followRepository.requestFollow(normalizedTargetProfileId);
  }
}
