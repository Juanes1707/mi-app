import type { FollowRequestDto } from '@/features/activity/data/dto/follow-requests-response';
import type { PendingFollowRequest } from '@/features/activity/domain/entities/pending-follow-request';

export function mapFollowRequestDtoToDomain(
  dto: FollowRequestDto,
): PendingFollowRequest {
  return {
    id: dto.id,
    requester: {
      id: dto.requester.id,
      username: dto.requester.username,
      displayName: dto.requester.displayName,
    },
    createdAt: dto.createdAt,
  };
}
