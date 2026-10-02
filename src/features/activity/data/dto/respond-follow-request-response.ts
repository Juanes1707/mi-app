import type { FollowRequestResolution } from '@/features/activity/domain/models/follow-request';

export type RespondFollowRequestResponseDto = {
  status: FollowRequestResolution;
};

export function isRespondFollowRequestResponseDto(
  value: unknown,
): value is RespondFollowRequestResponseDto {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'status' in value &&
    (value.status === 'accepted' || value.status === 'rejected')
  );
}
