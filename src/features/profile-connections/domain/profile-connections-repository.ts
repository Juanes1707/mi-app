import type {
  ProfileConnectionKind, ProfileConnectionsCursor, ProfileConnectionsPage,
} from '@/features/profile-connections/domain/profile-connection';

export interface ProfileConnectionsRepository {
  getPage(
    expectedOwnerUserId: string,
    targetUserId: string,
    kind: ProfileConnectionKind,
    limit: number,
    cursor: ProfileConnectionsCursor | null,
  ): Promise<ProfileConnectionsPage>;
}
