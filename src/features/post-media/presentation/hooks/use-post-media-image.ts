import type { ImageRef } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';

import { postImageSource } from '@/features/post-media/post-media-container';
import {
  planPostMediaImageLoad, type PostMediaImageState,
} from '@/features/post-media/presentation/post-media-image-state';

export type PostMediaImageViewState = PostMediaImageState<ImageRef>;

const IDLE: PostMediaImageViewState = { status: 'idle' };

export function usePostMediaImage(imagePath: string, isVisible: boolean) {
  const [state, setState] = useState<PostMediaImageViewState>(IDLE);
  const stateRef = useRef<PostMediaImageViewState>(IDLE);
  const [attempt, setAttempt] = useState(0);
  const commitState = useCallback((next: PostMediaImageViewState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const plan = planPostMediaImageLoad(stateRef.current, imagePath, isVisible);
    if (plan.state !== stateRef.current) commitState(plan.state);
    if (!plan.shouldRequest) return;
    let active = true;
    const request = postImageSource.request(imagePath);
    void request.result.then((outcome) => {
      if (!active) return;
      if (outcome.status === 'loaded') {
        commitState({ status: 'loaded', imagePath, image: outcome.image });
      } else if (outcome.status === 'failed') {
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

  // Render guard: a result for another imagePath (recycled row) or for an
  // offscreen cell is never exposed, even before the effect above runs.
  const visibleState = isVisible && state.status !== 'idle' && state.imagePath === imagePath
    ? state
    : IDLE;
  return { state: visibleState, retry };
}
