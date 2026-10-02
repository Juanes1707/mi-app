import type { ViewedProfile } from '@/features/profile-view/domain/entities/viewed-profile';
import { ProfileViewError } from '@/features/profile-view/domain/errors/profile-view-error';
import type { ProfileViewRepository } from '@/features/profile-view/domain/repositories/profile-view-repository';

export class GetProfileView {
  constructor(private readonly profileViewRepository: ProfileViewRepository) {}

  execute(profileId: string): Promise<ViewedProfile> {
    const normalizedProfileId = profileId.trim();

    if (!normalizedProfileId) {
      throw new ProfileViewError('invalid-request');
    }

    return this.profileViewRepository.getProfileById(normalizedProfileId);
  }
}
