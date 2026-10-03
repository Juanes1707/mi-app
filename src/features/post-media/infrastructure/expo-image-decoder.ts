import { Image, type ImageRef } from 'expo-image';

import { MAX_DECODED_EDGE_PX } from './post-media-cache-limits';
import type { PostImageDecoder } from './post-image-loader';
import { SerialTaskQueue } from './serial-task-queue';

// Glide (Android) writes the transformed bitmap to its disk cache AFTER handing the
// result back (DecodeJob.notifyEncodeAndRelease), so the purge right after a decode can
// run before that write lands. A trailing purge after the last decode removes it.
const TRAILING_PURGE_DELAY_MS = 1000;

export type InternalCacheStatus = { purged: boolean; consecutiveFailures: number };

// expo-image is only a decoder here: local cache file → native bitmap (ImageRef).
// `Image.loadAsync` accepts no cache policy in SDK 57 and runs through Glide's
// (Android) / SDWebImage's (iOS) automatic caches, so every decode is followed by a
// purge of those caches. Our RAM and disk LRUs remain the only deliberate caches.
//
// Purging cannot invalidate an ImageRef: the ref holds the Drawable/UIImage itself,
// and rendering it bypasses both automatic caches (skipMemoryCache + DiskCacheStrategy.NONE).
export class ExpoImageDecoder implements PostImageDecoder<ImageRef> {
  // Serializes ONLY the native decode + global purge section, so a global purge never
  // runs while another decode is mid-flight. Authorization, downloads and our disk
  // cache are not routed through this queue and stay concurrent.
  private readonly nativeSection = new SerialTaskQueue();
  // Starts dirty so residue left by earlier versions is purged before the first decode.
  private needsPurge = true;
  private consecutiveFailures = 0;
  private trailingPurge: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly trailingPurgeDelayMs = TRAILING_PURGE_DELAY_MS) {}

  get internalCacheStatus(): InternalCacheStatus {
    return { purged: !this.needsPurge, consecutiveFailures: this.consecutiveFailures };
  }

  async decode(localFileUri: string): Promise<ImageRef> {
    if (!localFileUri.startsWith('file://')) {
      throw new Error('Only local cache files can be decoded.');
    }
    return this.nativeSection.run(async () => {
      if (this.needsPurge) await this.purge();
      try {
        return await Image.loadAsync(
          { uri: localFileUri },
          { maxWidth: MAX_DECODED_EDGE_PX, maxHeight: MAX_DECODED_EDGE_PX },
        );
      } finally {
        this.needsPurge = true;
        await this.purge();
        this.scheduleTrailingPurge();
      }
    });
  }

  // Memory pressure and privacy purges: queued so they never interleave with a decode.
  purgeInternalCaches(): Promise<void> {
    return this.nativeSection.run(() => this.purge());
  }

  private scheduleTrailingPurge(): void {
    if (this.trailingPurge !== null) clearTimeout(this.trailingPurge);
    this.trailingPurge = setTimeout(() => {
      this.trailingPurge = null;
      void this.purgeInternalCaches();
    }, this.trailingPurgeDelayMs);
  }

  // Never throws. Both clears resolve to `false` on Android when there is no current
  // Activity; a failure keeps the cache marked dirty and is retried before the next decode.
  private async purge(): Promise<void> {
    const [memory, disk] = await Promise.allSettled([
      Image.clearMemoryCache(),
      Image.clearDiskCache(),
    ]);
    const purged = memory.status === 'fulfilled' && memory.value &&
      disk.status === 'fulfilled' && disk.value;
    if (purged) {
      this.needsPurge = false;
      this.consecutiveFailures = 0;
      return;
    }
    this.needsPurge = true;
    this.consecutiveFailures += 1;
    if (__DEV__) {
      console.warn('[post-media] expo-image internal cache purge failed; retrying before the next decode.');
    }
  }
}
