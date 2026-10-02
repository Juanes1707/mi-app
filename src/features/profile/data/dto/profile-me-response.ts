export type ProfileDto = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ProfileMeResponseDto = {
  profile: ProfileDto;
};

export function isProfileMeResponseDto(value: unknown): value is ProfileMeResponseDto {
  if (!isRecord(value) || !isRecord(value.profile)) {
    return false;
  }

  const profile = value.profile;

  return (
    typeof profile.id === 'string' &&
    isNullableString(profile.username) &&
    isNullableString(profile.displayName) &&
    isNullableString(profile.avatarUrl) &&
    typeof profile.bio === 'string' &&
    typeof profile.isPrivate === 'boolean' &&
    typeof profile.createdAt === 'string' &&
    typeof profile.updatedAt === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}
