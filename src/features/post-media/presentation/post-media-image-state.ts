export type PostMediaImageState<TImage> =
  | { status: 'idle' }
  | { status: 'loading'; imagePath: string }
  | { status: 'loaded'; imagePath: string; image: TImage }
  | { status: 'error'; imagePath: string; reason: 'not-found' | 'failed' };

export type PostMediaLoadPlan<TImage> = {
  state: PostMediaImageState<TImage>;
  shouldRequest: boolean;
};

const IDLE: PostMediaImageState<never> = { status: 'idle' };

// Centralizes the viewport transition so it can be regression-tested independently
// from React Native and the native ImageRef implementation.
export function planPostMediaImageLoad<TImage>(
  current: PostMediaImageState<TImage>,
  imagePath: string,
  isVisible: boolean,
): PostMediaLoadPlan<TImage> {
  const sameLoadedImage = current.status === 'loaded' && current.imagePath === imagePath;
  if (!isVisible) {
    // Keep a completed ImageRef while this FlatList row remains mounted. Pending work
    // is still cancelled by the hook cleanup and is not retained offscreen.
    return { state: sameLoadedImage ? current : IDLE, shouldRequest: false };
  }
  // Re-entering the viewport during the same mounted row is the same acquisition:
  // render the decoded image immediately. A recycled/unmounted row still starts from
  // idle and therefore performs fresh backend authorization before any cache lookup.
  if (sameLoadedImage) return { state: current, shouldRequest: false };
  return { state: { status: 'loading', imagePath }, shouldRequest: true };
}
