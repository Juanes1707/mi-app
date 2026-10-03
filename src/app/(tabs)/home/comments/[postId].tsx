import { useLocalSearchParams } from 'expo-router';

import { PostCommentsScreen } from '@/features/comments/presentation/screens/post-comments-screen';

export default function HomePostCommentsRoute() {
  const { postId } = useLocalSearchParams<{ postId?: string | string[] }>();

  return <PostCommentsScreen postId={typeof postId === 'string' ? postId : null} />;
}
