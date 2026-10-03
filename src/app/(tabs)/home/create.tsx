import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { invalidateFeed } from '@/features/feed/application/feed-invalidation';
import { CreatePostScreen } from '@/features/post-create/presentation/screens/create-post-screen';

export default function CreatePostRoute() {
  const router = useRouter();
  const onPublished = useCallback(() => {
    invalidateFeed();
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [router]);

  return <CreatePostScreen onPublished={onPublished} />;
}
