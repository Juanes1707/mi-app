export type PostMediaImageState<TImage> =
  | { status: 'idle' }
  | { status: 'loading'; imagePath: string }
  | { status: 'loaded'; imagePath: string; image: TImage }
  | { status: 'error'; imagePath: string; reason: 'not-found' | 'failed' };

// Where a row is relative to the screen, as decided by the list.
export type PostMediaViewport = {
  // Visible enough, for long enough: acquisitions (downloads) may start.
  isVisible: boolean;
  // Visible or next to a visible row: the row may hold a decoded bitmap.
  isRetained: boolean;
};

export type PostMediaLoadPlan<TImage> = {
  state: PostMediaImageState<TImage>;
  shouldRequest: boolean;
  // The bitmap on screen came from the RAM cache without a fresh acquisition: once
  // visible, the row must still request it so access is re-authorized.
  needsRevalidation: boolean;
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

// A far row never renders a bitmap, not even for the frame before its effect runs.
export function selectPostMediaImageViewState<TImage>(
  current: PostMediaImageState<TImage>,
  imagePath: string,
  isRetained = true,
): PostMediaImageState<TImage> {
  return isRetained && current.status !== 'idle' && current.imagePath === imagePath
    ? current
    : IDLE;
}

// Centralizes the viewport transitions so they can be regression-tested independently
// from React Native and the native ImageRef implementation:
// - far from the screen: the row lets go of its bitmap (only the byte-budgeted RAM
//   LRU may keep it), so decoded memory is bounded by the viewport, not by how many
//   rows the list keeps mounted;
// - next to the screen: the bitmap is kept, or restored from RAM before the row
//   scrolls in, so crossing the visibility threshold never flashes the placeholder,
//   but no download starts;
// - visible: load it, or revalidate a RAM preview.
export function planPostMediaImageLoad<TImage>(
  current: PostMediaImageState<TImage>,
  imagePath: string,
  { isVisible, isRetained }: PostMediaViewport,
  peekCached: () => TImage | undefined,
  needsRevalidation = false,
): PostMediaLoadPlan<TImage> {
  // Pending work is cancelled by the hook cleanup and is never kept alive offscreen.
  if (!isRetained) return { state: IDLE, shouldRequest: false, needsRevalidation: false };

  let state = current;
  let revalidate = needsRevalidation;
  if (!(current.status === 'loaded' && current.imagePath === imagePath)) {
    const cached = peekCached();
    if (cached !== undefined) {
      state = { status: 'loaded', imagePath, image: cached };
      revalidate = true;
    }
  }
  const loaded = state.status === 'loaded' && state.imagePath === imagePath;
  if (!isVisible) {
    return { state: loaded ? state : IDLE, shouldRequest: false, needsRevalidation: loaded && revalidate };
  }
  if (loaded) return { state, shouldRequest: revalidate, needsRevalidation: revalidate };
  return { state: { status: 'loading', imagePath }, shouldRequest: true, needsRevalidation: false };
}
