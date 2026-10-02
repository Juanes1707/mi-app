import type { Profile } from '@/features/profile/domain/entities/profile';
import { ProfileError } from '@/features/profile/domain/errors/profile-error';
import type { ProfileUpdate } from '@/features/profile/domain/models/profile-update';
import type { ProfileRepository } from '@/features/profile/domain/repositories/profile-repository';

export class UpdateMyProfile {
  constructor(private readonly profileRepository: ProfileRepository) {}

  async execute(update: ProfileUpdate): Promise<Profile> {
    if (!hasAtLeastOneUpdate(update)) {
      throw new ProfileError('invalid-update');
    }

    return this.profileRepository.updateMyProfile(update);
  }
}

function hasAtLeastOneUpdate(update: ProfileUpdate): boolean {
  return (
    update.username !== undefined ||
    update.displayName !== undefined ||
    update.bio !== undefined ||
    update.isPrivate !== undefined
  );
}
