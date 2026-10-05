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

export function initialPostMediaImageState<TImage>(
  imagePath: string,
  cachedImage: TImage | undefined,
): PostMediaImageState<TImage> {
  return cachedImage === undefined
    ? IDLE
    : { status: 'loaded', imagePath, image: cachedImage };
}

export function selectPostMediaImageViewState<TImage>(
  current: PostMediaImageState<TImage>,
  imagePath: string,
): PostMediaImageState<TImage> {
  return current.status !== 'idle' && current.imagePath === imagePath
    ? current
    : IDLE;
}

// Centralizes the viewport transition so it can be regression-tested independently
// from React Native and the native ImageRef implementation.
export function planPostMediaImageLoad<TImage>(
  current: PostMediaImageState<TImage>,
  imagePath: string,
  isVisible: boolean,
  shouldRevalidate = false,
): PostMediaLoadPlan<TImage> {
  const sameLoadedImage = current.status === 'loaded' && current.imagePath === imagePath;
  if (!isVisible) {
    // Keep a completed ImageRef while this FlatList row remains mounted. Pending work
    // is still cancelled by the hook cleanup and is not retained offscreen.
    return { state: sameLoadedImage ? current : IDLE, shouldRequest: false };
  }
  // Re-entering during the same mounted row needs no new work. A remounted row may
  // render its RAM preview while shouldRevalidate keeps fresh authorization running.
  if (sameLoadedImage) return { state: current, shouldRequest: shouldRevalidate };
  return { state: { status: 'loading', imagePath }, shouldRequest: true };
}
