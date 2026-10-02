export type ProfileViewRelationshipDto =
  | {
      status: 'none';
    }
  | {
      status: 'following';
    }
  | {
      status: 'request_pending';
      requestId: string;
    };

export type ProfileViewResponseDto = {
  profile: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string;
    isPrivate: boolean;
  };
  isSelf: boolean;
  relationship: ProfileViewRelationshipDto;
};

export function isProfileViewResponseDto(
  value: unknown,
): value is ProfileViewResponseDto {
  if (
    !isRecord(value) ||
    !isRecord(value.profile) ||
    !isRecord(value.relationship)
  ) {
    return false;
  }

  const profile = value.profile;
  const relationship = value.relationship;

  if (
    typeof profile.id !== 'string' ||
    !isNullableString(profile.username) ||
    !isNullableString(profile.displayName) ||
    !isNullableString(profile.avatarUrl) ||
    typeof profile.bio !== 'string' ||
    typeof profile.isPrivate !== 'boolean' ||
    typeof value.isSelf !== 'boolean'
  ) {
    return false;
  }

  if (relationship.status === 'request_pending') {
    if (
      typeof relationship.requestId !== 'string' ||
      relationship.requestId.trim() === '' ||
      value.isSelf
    ) {
      return false;
    }

    return true;
  }

  if (
    relationship.status !== 'none' &&
    relationship.status !== 'following'
  ) {
    return false;
  }

  if (hasOwnField(relationship, 'requestId')) {
    return false;
  }

  return !value.isSelf || relationship.status === 'none';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function hasOwnField(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}
