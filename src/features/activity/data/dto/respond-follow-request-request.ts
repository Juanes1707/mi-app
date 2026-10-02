import type { FollowRequestDecision } from '@/features/activity/domain/models/follow-request';

export type RespondFollowRequestRequestDto = {
  requestId: string;
  decision: FollowRequestDecision;
};

export function mapRespondFollowRequestToRequestDto(
  requestId: string,
  decision: FollowRequestDecision,
): RespondFollowRequestRequestDto {
  return { requestId, decision };
}
