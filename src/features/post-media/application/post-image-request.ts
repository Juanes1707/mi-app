import type { PostMediaError } from '@/features/post-media/domain/post-media-error';

// A cancellation is not a failure: it only means the consumer stopped needing the image.
export type PostImageOutcome<TImage> =
  | { status: 'loaded'; image: TImage }
  | { status: 'failed'; error: PostMediaError }
  | { status: 'cancelled' };

// One consumer's lease on an image acquisition. `result` never rejects and
// settles exactly once; `cancel()` is idempotent and safe after settlement.
export type PostImageRequest<TImage> = {
  result: Promise<PostImageOutcome<TImage>>;
  cancel(): void;
};

export interface PostImageSource<TImage> {
  // Synchronous level-one preview for media whose path came from an already
  // authorized application response. Callers must still request() so access is
  // revalidated and revoked media can be purged.
  peek(imagePath: string): TImage | undefined;
  request(imagePath: string): PostImageRequest<TImage>;
}
