import type { RequestFollowResponseDto } from '@/features/follow/data/dto/request-follow-response';
import type { FollowResult } from '@/features/follow/domain/models/follow-result';

export function mapRequestFollowResponseDtoToDomain(
  dto: RequestFollowResponseDto,
): FollowResult {
  if (dto.status === 'following') {
    return { status: 'following' };
  }

  return {
    status: 'request-pending',
    requestId: dto.requestId,
  };
}
