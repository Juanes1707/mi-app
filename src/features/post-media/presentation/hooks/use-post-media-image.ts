import type { ImageRef } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';

import { postImageSource } from '@/features/post-media/post-media-container';

export type PostMediaImageState =
  | { status: 'idle' }
  | { status: 'loading'; imagePath: string }
  | { status: 'loaded'; imagePath: string; image: ImageRef }
  | { status: 'error'; imagePath: string; reason: 'not-found' | 'failed' };

const IDLE: PostMediaImageState = { status: 'idle' };

export function usePostMediaImage(imagePath: string, isVisible: boolean) {
  const [state, setState] = useState<PostMediaImageState>(IDLE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isVisible) {
      // Offscreen: drop our ImageRef so the bitmap is reclaimable; start nothing.
      setState(IDLE);
      return;
    }
    let active = true;
    setState({ status: 'loading', imagePath });
    const request = postImageSource.request(imagePath);
    void request.result.then((outcome) => {
      if (!active) return;
      if (outcome.status === 'loaded') {
        setState({ status: 'loaded', imagePath, image: outcome.image });
      } else if (outcome.status === 'failed') {
        setState({
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
  }, [imagePath, isVisible, attempt]);

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
