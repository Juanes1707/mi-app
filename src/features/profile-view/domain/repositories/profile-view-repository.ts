import type { ViewedProfile } from '@/features/profile-view/domain/entities/viewed-profile';

export interface ProfileViewRepository {
  getProfileById(profileId: string): Promise<ViewedProfile>;
}
