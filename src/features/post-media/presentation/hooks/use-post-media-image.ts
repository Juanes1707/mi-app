import type { ImageRef } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';

import { postImageSource } from '@/features/post-media/post-media-container';
import {
  initialPostMediaImageState, planPostMediaImageLoad, type PostMediaImageState,
  selectPostMediaImageViewState,
} from '@/features/post-media/presentation/post-media-image-state';

export type PostMediaImageViewState = PostMediaImageState<ImageRef>;

export function usePostMediaImage(imagePath: string, isVisible: boolean) {
  const [state, setState] = useState<PostMediaImageViewState>(() => (
    initialPostMediaImageState(imagePath, postImageSource.peek(imagePath))
  ));
  const stateRef = useRef<PostMediaImageViewState>(state);
  const shouldRevalidateRef = useRef(state.status === 'loaded');
  const [attempt, setAttempt] = useState(0);
  const commitState = useCallback((next: PostMediaImageViewState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const plan = planPostMediaImageLoad(
      stateRef.current,
      imagePath,
      isVisible,
      shouldRevalidateRef.current,
    );
    if (plan.state !== stateRef.current) commitState(plan.state);
    if (!plan.shouldRequest) return;
    let active = true;
    const request = postImageSource.request(imagePath);
    void request.result.then((outcome) => {
      if (!active) return;
      if (outcome.status === 'loaded') {
        shouldRevalidateRef.current = false;
        commitState({ status: 'loaded', imagePath, image: outcome.image });
      } else if (outcome.status === 'failed') {
        shouldRevalidateRef.current = false;
        commitState({
          status: 'error',
          imagePath,
          reason: outcome.error.code === 'not-found' ? 'not-found' : 'failed',
        });
      }
    });
    // Leaving the viewport, a new imagePath or unmount: this consumer lets go.
    // If it was the last one, the shared download is aborted.
    return () => {
      active = false;
      request.cancel();
    };
  }, [imagePath, isVisible, attempt, commitState]);

  const retry = useCallback(() => {
    if (isVisible) setAttempt((current) => current + 1);
  }, [isVisible]);

  // Viewability controls acquisitions and cancellation. A completed bitmap stays
  // rendered while its row exists, so crossing the viewability threshold cannot
  // flash the placeholder. The imagePath guard still protects recycled rows.
  return { state: selectPostMediaImageViewState(state, imagePath), retry };
}
