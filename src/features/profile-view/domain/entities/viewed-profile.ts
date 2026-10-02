import type { ProfileRelationship } from '@/features/profile-view/domain/models/profile-relationship';

export type ViewedProfile = {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string;
  isPrivate: boolean;
  isSelf: boolean;
  relationship: ProfileRelationship;
};
