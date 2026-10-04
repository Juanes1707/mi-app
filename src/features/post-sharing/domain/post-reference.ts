import { normalizeUuid } from '@/shared/domain/uuid';

export function buildPostDeepLink(postId: string): string | null {
  const normalizedPostId = normalizeUuid(postId);
  return normalizedPostId === null ? null : `instagramclone://post/${normalizedPostId}`;
}
