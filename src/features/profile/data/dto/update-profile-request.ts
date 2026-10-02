import type { ProfileUpdate } from '@/features/profile/domain/models/profile-update';

export type UpdateProfileRequestDto = {
  username?: string;
  displayName?: string | null;
  bio?: string;
  isPrivate?: boolean;
};

export function mapProfileUpdateToRequestDto(
  update: ProfileUpdate,
): UpdateProfileRequestDto {
  const request: UpdateProfileRequestDto = {};

  if (update.username !== undefined) {
    request.username = update.username;
  }

  if (update.displayName !== undefined) {
    request.displayName = update.displayName;
  }

  if (update.bio !== undefined) {
    request.bio = update.bio;
  }

  if (update.isPrivate !== undefined) {
    request.isPrivate = update.isPrivate;
  }

  return request;
}
