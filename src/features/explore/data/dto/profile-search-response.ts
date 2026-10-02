export type ProfileSearchResponseDto = {
  profiles: {
    id: string;
    username: string | null;
    displayName: string | null;
    isPrivate: boolean;
  }[];
};

export function isProfileSearchResponseDto(
  value: unknown,
): value is ProfileSearchResponseDto {
  if (!isRecord(value) || !Array.isArray(value.profiles)) {
    return false;
  }

  return value.profiles.every(
    (profile: unknown) =>
      isRecord(profile) &&
      typeof profile.id === 'string' &&
      isNullableString(profile.username) &&
      isNullableString(profile.displayName) &&
      typeof profile.isPrivate === 'boolean',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
