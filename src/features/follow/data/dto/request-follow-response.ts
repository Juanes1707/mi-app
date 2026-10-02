export type RequestFollowResponseDto =
  | {
      status: 'following';
    }
  | {
      status: 'request_pending';
      requestId: string;
    };

export function isRequestFollowResponseDto(
  value: unknown,
): value is RequestFollowResponseDto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  if (!('status' in value)) {
    return false;
  }

  if (value.status === 'following') {
    return true;
  }

  return (
    value.status === 'request_pending' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    value.requestId.trim() !== ''
  );
}
