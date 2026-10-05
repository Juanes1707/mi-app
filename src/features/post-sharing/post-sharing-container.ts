import { Share } from 'react-native';

import { sharePostReference } from '@/features/post-sharing/application/share-post-reference';
import { buildPostShareLink } from '@/features/post-sharing/domain/post-reference';
import { expoGoPostAppUrl } from '@/features/post-sharing/infrastructure/expo-go-post-app-url';
import { getBackendBaseUrl } from '@/infrastructure/api/backend-api-client';

export function sharePost(postId: string): Promise<void> {
  return sharePostReference(
    postId,
    (id) => buildPostShareLink(getBackendBaseUrl(), id, expoGoPostAppUrl(id)),
    Share.share,
  );
}
