import type { ImageRef } from 'expo-image';

import { AuthorizePostMediaRead } from '@/features/post-media/application/authorize-post-media-read';
import type { PostImageSource } from '@/features/post-media/application/post-image-request';
import { BackendPostMediaRepository } from '@/features/post-media/data/backend-post-media-repository';
import { DiskImageCache } from '@/features/post-media/infrastructure/disk-image-cache';
import { ExpoDiskCacheFileSystem } from '@/features/post-media/infrastructure/expo-disk-cache-file-system';
import { ExpoImageDecoder } from '@/features/post-media/infrastructure/expo-image-decoder';
import { ExpoPostMediaDownloader } from '@/features/post-media/infrastructure/expo-post-media-downloader';
import {
  estimateDecodedBitmapBytes, LruMemoryImageCache,
} from '@/features/post-media/infrastructure/lru-memory-image-cache';
import { subscribeToMemoryPressure } from '@/features/post-media/infrastructure/memory-pressure';
import {
  POST_MEDIA_DISK_BUDGET_BYTES, POST_MEDIA_DISK_DIRECTORY, POST_MEDIA_MAX_FILE_BYTES,
  POST_MEDIA_MEMORY_BUDGET_BYTES,
} from '@/features/post-media/infrastructure/post-media-cache-limits';
import { PostImageLoader } from '@/features/post-media/infrastructure/post-image-loader';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

const memoryCache = new LruMemoryImageCache<ImageRef>(
  POST_MEDIA_MEMORY_BUDGET_BYTES,
  estimateDecodedBitmapBytes,
);
const diskCache = new DiskImageCache(new ExpoDiskCacheFileSystem(POST_MEDIA_DISK_DIRECTORY), {
  budgetBytes: POST_MEDIA_DISK_BUDGET_BYTES,
  maxFileBytes: POST_MEDIA_MAX_FILE_BYTES,
});
const decoder = new ExpoImageDecoder();

export const postImageSource: PostImageSource<ImageRef> = new PostImageLoader<ImageRef>({
  authorizer: new AuthorizePostMediaRead(
    new BackendPostMediaRepository(authenticatedBackendApiClient),
  ),
  memory: memoryCache,
  disk: diskCache,
  downloader: new ExpoPostMediaDownloader(),
  decoder,
});

export function bindPostMediaMemoryPressure(): () => void {
  return subscribeToMemoryPressure(() => {
    memoryCache.clear();
    void decoder.purgeInternalCaches();
  });
}
