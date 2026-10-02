export type FollowRequestDto = {
  id: string;
  requester: {
    id: string;
    username: string | null;
    displayName: string | null;
  };
  createdAt: string;
};

export type FollowRequestsResponseDto = {
  requests: FollowRequestDto[];
};

export function isFollowRequestsResponseDto(
  value: unknown,
): value is FollowRequestsResponseDto {
  if (!isRecord(value) || !Array.isArray(value.requests)) {
    return false;
  }

  return value.requests.every(isFollowRequestDto);
}

function isFollowRequestDto(value: unknown): value is FollowRequestDto {
  if (!isRecord(value) || !isRecord(value.requester)) {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    typeof value.requester.id === 'string' &&
    isNullableString(value.requester.username) &&
    isNullableString(value.requester.displayName) &&
    typeof value.createdAt === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}
