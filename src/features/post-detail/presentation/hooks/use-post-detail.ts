import { useCallback, useEffect, useRef, useState } from 'react';

import { getPost } from '@/features/post-detail/post-detail-container';
import {
  PostDetailRequestCoordinator,
  type PostDetailState,
  type PostReader,
} from '@/features/post-detail/presentation/post-detail-request-coordinator';

export function usePostDetail(postId: string, reader: PostReader = getPost) {
  const [state, setState] = useState<PostDetailState>({ postId, status: 'loading' });
  const coordinatorRef = useRef<PostDetailRequestCoordinator | null>(null);

  useEffect(() => {
    const coordinator = new PostDetailRequestCoordinator(reader, postId, setState);
    coordinatorRef.current = coordinator;
    coordinator.load(postId);
    return () => {
      coordinator.dispose();
      if (coordinatorRef.current === coordinator) coordinatorRef.current = null;
    };
  }, [postId, reader]);

  const retry = useCallback(() => {
    coordinatorRef.current?.retry();
  }, []);

  const refresh = useCallback(() => {
    coordinatorRef.current?.refresh();
  }, []);

  // A prop switch never exposes P while Q is starting, even before the effect runs.
  return {
    state: state.postId === postId ? state : { postId, status: 'loading' as const },
    retry,
    refresh,
  };
}
