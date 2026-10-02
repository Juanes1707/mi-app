import type { Profile } from '@/features/profile/domain/entities/profile';
import type { ProfileRepository } from '@/features/profile/domain/repositories/profile-repository';

export class GetMyProfile {
  constructor(private readonly profileRepository: ProfileRepository) {}

  execute(): Promise<Profile> {
    return this.profileRepository.getMyProfile();
  }
}
