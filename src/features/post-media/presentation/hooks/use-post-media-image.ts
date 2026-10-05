import type { ImageRef } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';

import { postImageSource } from '@/features/post-media/post-media-container';
import {
  initialPostMediaImageState, planPostMediaImageLoad, type PostMediaImageState,
  selectPostMediaImageViewState,
} from '@/features/post-media/presentation/post-media-image-state';

export type PostMediaImageViewState = PostMediaImageState<ImageRef>;

// `isRetained` defaults to true for single-image screens (Post detail); the Feed sets
// it per row so only rows on or next to the screen hold a decoded bitmap.
export function usePostMediaImage(imagePath: string, isVisible: boolean, isRetained = true) {
  const [state, setState] = useState<PostMediaImageViewState>(() => (
    initialPostMediaImageState(imagePath, isRetained ? postImageSource.peek(imagePath) : undefined)
  ));
  const stateRef = useRef<PostMediaImageViewState>(state);
  const needsRevalidationRef = useRef(state.status === 'loaded');
  const [attempt, setAttempt] = useState(0);
  const commitState = useCallback((next: PostMediaImageViewState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const plan = planPostMediaImageLoad(
      stateRef.current,
      imagePath,
      { isVisible, isRetained },
      () => postImageSource.peek(imagePath),
      needsRevalidationRef.current,
    );
    needsRevalidationRef.current = plan.needsRevalidation;
    // Dropping a far row's ImageRef from state is what lets Hermes collect it:
    // expo-image reports the bitmap size to the GC as external memory pressure.
    if (plan.state !== stateRef.current) commitState(plan.state);
    if (!plan.shouldRequest) return;
    let active = true;
    const request = postImageSource.request(imagePath);
    void request.result.then((outcome) => {
      if (!active) return;
      if (outcome.status === 'loaded') {
        needsRevalidationRef.current = false;
        commitState({ status: 'loaded', imagePath, image: outcome.image });
      } else if (outcome.status === 'failed') {
        needsRevalidationRef.current = false;
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
  }, [imagePath, isVisible, isRetained, attempt, commitState]);

  const retry = useCallback(() => {
    if (isVisible) setAttempt((current) => current + 1);
  }, [isVisible]);

  // The imagePath guard protects recycled rows; a far row never renders a bitmap.
  return { state: selectPostMediaImageViewState(state, imagePath, isRetained), retry };
}
