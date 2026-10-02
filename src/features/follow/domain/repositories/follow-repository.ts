import type { FollowResult } from '@/features/follow/domain/models/follow-result';

export interface FollowRepository {
  requestFollow(targetProfileId: string): Promise<FollowResult>;
}
