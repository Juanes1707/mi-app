import { Stack, useLocalSearchParams } from 'expo-router';

import { PostDetailScreen } from '@/features/post-detail/presentation/screens/post-detail-screen';

export default function PostDetailRoute() {
  const { postId } = useLocalSearchParams<'/post/[postId]'>();

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Publicación' }} />
      <PostDetailScreen postId={typeof postId === 'string' ? postId : null} />
    </>
  );
}
