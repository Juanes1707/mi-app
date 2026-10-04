import { Share, type ShareContent } from 'react-native';

import { buildPostDeepLink } from '@/features/post-sharing/domain/post-reference';

export type NativePostShare = (
  content: ShareContent,
  options?: { dialogTitle?: string },
) => Promise<unknown>;

export async function sharePostReference(
  postId: string,
  nativeShare: NativePostShare = Share.share,
): Promise<void> {
  const url = buildPostDeepLink(postId);

  if (url === null) {
    throw new Error('A valid Post id is required for sharing.');
  }

  await nativeShare(
    { message: url, title: 'Compartir publicación' },
    { dialogTitle: 'Compartir publicación' },
  );
}
