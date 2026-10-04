import { Stack, useLocalSearchParams } from 'expo-router';

import { PostCommentsScreen } from '@/features/comments/presentation/screens/post-comments-screen';

export default function PostDetailCommentsRoute() {
  const { postId } = useLocalSearchParams<'/post/[postId]/comments'>();

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Comentarios' }} />
      <PostCommentsScreen postId={typeof postId === 'string' ? postId : null} />
    </>
  );
}
