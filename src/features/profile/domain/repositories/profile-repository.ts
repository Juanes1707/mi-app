import type { Profile } from '@/features/profile/domain/entities/profile';
import type { ProfileUpdate } from '@/features/profile/domain/models/profile-update';

export interface ProfileRepository {
  getMyProfile(): Promise<Profile>;
  updateMyProfile(update: ProfileUpdate): Promise<Profile>;
}
