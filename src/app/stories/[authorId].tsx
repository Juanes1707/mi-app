import { Stack, useLocalSearchParams } from 'expo-router';

import { StoriesViewerScreen } from '@/features/stories/presentation/screens/stories-viewer-screen';

// Root-level fullscreen route (outside the tab stacks): only the author id travels.
export default function StoriesRoute() {
  const { authorId } = useLocalSearchParams<'/stories/[authorId]'>();

  return (
    <>
      <Stack.Screen
        options={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: '#000' } }}
      />
      <StoriesViewerScreen authorId={typeof authorId === 'string' ? authorId : null} />
    </>
  );
}
