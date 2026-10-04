import type {
  ProfileConnectionKind, ProfileConnectionsCursor, ProfileConnectionsPage,
} from '@/features/profile-connections/domain/profile-connection';
import { ProfileConnectionsError } from '@/features/profile-connections/domain/profile-connections-error';
import type { ProfileConnectionsRepository } from '@/features/profile-connections/domain/profile-connections-repository';
import { parsePostgresTimestamp } from '@/shared/domain/postgres-timestamp';
import { normalizeUuid } from '@/shared/domain/uuid';

export const PROFILE_CONNECTIONS_PAGE_SIZE = 30;

export class GetProfileConnectionsPage {
  constructor(private readonly repository: ProfileConnectionsRepository) {}

  execute(
    ownerUserId: string,
    targetUserId: string,
    kind: ProfileConnectionKind,
    cursor: ProfileConnectionsCursor | null,
    limit = PROFILE_CONNECTIONS_PAGE_SIZE,
  ): Promise<ProfileConnectionsPage> {
    const owner = normalizeUuid(ownerUserId);
    const target = normalizeUuid(targetUserId);
    const cursorUserId = cursor === null ? null : normalizeUuid(cursor.userId);
    if (owner === null || target === null || (kind !== 'followers' && kind !== 'following') ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
        (cursor !== null &&
          (cursorUserId === null || parsePostgresTimestamp(cursor.connectedAt) === null))) {
      throw new ProfileConnectionsError('invalid-request');
    }
    const normalizedCursor = cursor === null
      ? null
      : { connectedAt: cursor.connectedAt, userId: cursorUserId as string };
    return this.repository.getPage(owner, target, kind, limit, normalizedCursor);
  }
}
