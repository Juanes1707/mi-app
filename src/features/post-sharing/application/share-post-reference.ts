import type { ShareContent } from 'react-native';

export type NativePostShare = (
  content: ShareContent,
  options?: { dialogTitle?: string },
) => Promise<unknown>;

// Builds the link to share for one Post (see buildPostShareLink), or null if invalid.
export type PostShareLinkFactory = (postId: string) => string | null;

export async function sharePostReference(
  postId: string,
  createShareLink: PostShareLinkFactory,
  nativeShare: NativePostShare,
): Promise<void> {
  const link = createShareLink(postId);

  if (link === null) {
    throw new Error('A valid Post id is required for sharing.');
  }

  await nativeShare(
    { message: `Mira esta publicación en InstagramClone:\n${link}`, title: 'Compartir publicación' },
    { dialogTitle: 'Compartir publicación' },
  );
}
