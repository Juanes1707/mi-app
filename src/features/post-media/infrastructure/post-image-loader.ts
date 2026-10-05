import type {
  PostImageOutcome, PostImageRequest, PostImageSource,
} from '@/features/post-media/application/post-image-request';
import type { AuthorizedPostMedia } from '@/features/post-media/domain/authorized-post-media';
import { PostMediaError } from '@/features/post-media/domain/post-media-error';
import type { PartialDownloadTarget } from './disk-image-cache';

export interface PostMediaReadAuthorizer {
  execute(imagePath: string): Promise<AuthorizedPostMedia>;
}

export interface PostImageMemoryCache<TImage> {
  get(key: string): TImage | undefined;
  set(key: string, image: TImage): boolean;
  delete(key: string): void;
}

export interface PostImageDiskCache {
  lookup(imagePath: string): Promise<string | null>;
  preparePartial(imagePath: string): Promise<PartialDownloadTarget>;
  discardPartial(name: string): Promise<void>;
  commit(imagePath: string, partialName: string): Promise<string>;
  remove(imagePath: string): Promise<void>;
}

export interface PostMediaDownloader {
  download(url: string, destinationUri: string, signal: AbortSignal): Promise<void>;
}

// Decodes a LOCAL file only. Remote URLs never reach the decoder. Any copy the
// decoding library keeps on its own must be dropped by `purgeInternalCaches()`.
export interface PostImageDecoder<TImage> {
  decode(localFileUri: string): Promise<TImage>;
  purgeInternalCaches(): Promise<void>;
}

export type PostImageLoaderDependencies<TImage> = {
  authorizer: PostMediaReadAuthorizer;
  memory: PostImageMemoryCache<TImage>;
  disk: PostImageDiskCache;
  downloader: PostMediaDownloader;
  decoder: PostImageDecoder<TImage>;
};

type Consumer<TImage> = {
  done: boolean;
  resolve: (outcome: PostImageOutcome<TImage>) => void;
};

// One acquisition shared by every consumer that asked for the same imagePath meanwhile.
type LoadJob<TImage> = {
  imagePath: string;
  consumers: Set<Consumer<TImage>>;
  controller: AbortController;
};

export class PostImageLoader<TImage> implements PostImageSource<TImage> {
  private readonly inFlight = new Map<string, LoadJob<TImage>>();

  constructor(private readonly deps: PostImageLoaderDependencies<TImage>) {}

  peek(imagePath: string): TImage | undefined {
    return this.deps.memory.get(imagePath);
  }

  request(imagePath: string): PostImageRequest<TImage> {
    const existing = this.inFlight.get(imagePath);
    const job: LoadJob<TImage> = existing ?? {
      imagePath,
      consumers: new Set(),
      controller: new AbortController(),
    };

    let resolveOutcome: (outcome: PostImageOutcome<TImage>) => void = () => undefined;
    const result = new Promise<PostImageOutcome<TImage>>((resolve) => {
      resolveOutcome = resolve;
    });
    const consumer: Consumer<TImage> = { done: false, resolve: resolveOutcome };
    job.consumers.add(consumer);

    if (existing === undefined) {
      this.inFlight.set(imagePath, job);
      void this.run(job);
    }

    return {
      result,
      cancel: () => {
        if (consumer.done) return;
        consumer.done = true;
        job.consumers.delete(consumer);
        consumer.resolve({ status: 'cancelled' });
        if (job.consumers.size === 0) this.abandon(job);
      },
    };
  }

  // The last interested consumer left: stop sharing the job and abort its download.
  private abandon(job: LoadJob<TImage>): void {
    if (this.inFlight.get(job.imagePath) === job) this.inFlight.delete(job.imagePath);
    job.controller.abort();
  }

  private settle(job: LoadJob<TImage>, outcome: PostImageOutcome<TImage>): void {
    if (this.inFlight.get(job.imagePath) === job) this.inFlight.delete(job.imagePath);
    for (const consumer of job.consumers) {
      consumer.done = true;
      consumer.resolve(outcome);
    }
    job.consumers.clear();
  }

  private async run(job: LoadJob<TImage>): Promise<void> {
    const { imagePath } = job;
    const { signal } = job.controller;
    const { authorizer, memory, disk } = this.deps;
    try {
      // 1. Fresh authorization for EVERY acquisition. Cached bytes are resources,
      //    not permissions: no cache level is consulted before this succeeds.
      const media = await authorizer.execute(imagePath);

      // 2. RAM.
      const inMemory = memory.get(imagePath);
      if (inMemory !== undefined) {
        this.settle(job, { status: 'loaded', image: inMemory });
        return;
      }
      if (signal.aborted) return;

      // 3. Disk. A file that vanished or does not decode is dropped, and we fall
      //    through to at most ONE fresh network attempt.
      const cachedUri = await disk.lookup(imagePath);
      if (cachedUri !== null) {
        const image = await this.tryDecode(cachedUri);
        if (image !== null) {
          this.retainAndSettle(job, image);
          return;
        }
        await disk.remove(imagePath);
      }
      if (signal.aborted) return;

      // 4–8. Network, using the URL that was authorized for THIS acquisition only.
      const downloadedUri = await this.downloadToDisk(imagePath, media.signedUrl, signal);
      if (downloadedUri === null) return;
      const image = await this.tryDecode(downloadedUri);
      if (image === null) {
        await disk.remove(imagePath);
        throw new PostMediaError('unavailable');
      }
      this.retainAndSettle(job, image);
    } catch (error: unknown) {
      const failure = error instanceof PostMediaError ? error : new PostMediaError('unavailable');
      if (failure.code === 'not-found') {
        // Deleted post or revoked access: local bytes must not outlive the permission.
        memory.delete(imagePath);
        await disk.remove(imagePath).catch(() => undefined);
        await this.deps.decoder.purgeInternalCaches();
      }
      this.settle(job, { status: 'failed', error: failure });
    }
  }

  // A decode that finishes after every consumer left is still a valid, authorized
  // cache entry backed by a final file; it is retained but delivered to nobody.
  private retainAndSettle(job: LoadJob<TImage>, image: TImage): void {
    this.deps.memory.set(job.imagePath, image);
    this.settle(job, { status: 'loaded', image });
  }

  private async tryDecode(localFileUri: string): Promise<TImage | null> {
    try {
      return await this.deps.decoder.decode(localFileUri);
    } catch {
      return null;
    }
  }

  // Returns the committed local URI, or null when the job was cancelled.
  private async downloadToDisk(
    imagePath: string,
    signedUrl: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    const { disk, downloader } = this.deps;
    const partial = await disk.preparePartial(imagePath);
    try {
      if (signal.aborted) return null;
      await downloader.download(signedUrl, partial.uri, signal);
      if (signal.aborted) return null;
      return await disk.commit(imagePath, partial.name);
    } catch {
      if (signal.aborted) return null;
      throw new PostMediaError('unavailable');
    } finally {
      // No-op after a successful commit (the partial was moved); otherwise removes it.
      await disk.discardPartial(partial.name).catch(() => undefined);
    }
  }
}
