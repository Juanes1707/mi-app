import type {
  CreateStoryId, PrepareStoryImageUpload, PublishStory, UploadStoryImage,
} from '@/features/stories/application/story-use-cases';
import type { LocalStoryImage, PublishedStory, StoryUploadTicket } from '@/features/stories/domain/story';
import { StoriesError, type StoriesErrorCode } from '@/features/stories/domain/stories-error';
import type { StoryImageSelector } from '@/features/stories/domain/stories-repository';
import { storyImagePathFor } from '@/features/stories/domain/story-values';

export type StoryPublicationPhase =
  | 'idle' | 'picking' | 'preparing' | 'uploading' | 'publishing' | 'success' | 'error';

export type StoryPublicationState = {
  phase: StoryPublicationPhase;
  error: StoriesError | null;
  // A retry continues the SAME intention (same Story id); otherwise only discard.
  canRetry: boolean;
};

export type StoryPublicationDependencies = {
  selector: StoryImageSelector;
  createStoryId: CreateStoryId;
  prepare: PrepareStoryImageUpload;
  upload: UploadStoryImage;
  publish: PublishStory;
};

// One publication intention = one Story id, created on the device AFTER a valid pick
// (a cancelled picker spends nothing) and kept across every retry: the backend is
// idempotent by that id, so an ambiguous step can be repeated without a duplicate.
type Attempt = {
  storyId: string;
  image: LocalStoryImage;
  ticket: StoryUploadTicket | null;
  // The object is known to exist (upload confirmed, or the id is already published).
  uploaded: boolean;
};

const RETRYABLE: ReadonlySet<StoriesErrorCode> = new Set([
  'unavailable', 'upload-unavailable', 'media-not-ready', 'invalid-response', 'profile-not-ready',
]);

export class StoryPublicationController {
  private state: StoryPublicationState = { phase: 'idle', error: null, canRetry: false };
  private readonly listeners = new Set<() => void>();
  private attempt: Attempt | null = null;
  private busy = false;
  private generation = 0;
  private disposed = false;

  constructor(
    private readonly ownerUserId: string,
    private readonly deps: StoryPublicationDependencies,
    private readonly onPublished: (story: PublishedStory) => void,
  ) {}

  getState = (): StoryPublicationState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  // Tap "+": pick one image and publish it. A second tap while busy is ignored.
  async pickAndPublish(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    const generation = ++this.generation;
    this.attempt = null;
    this.publish({ phase: 'picking', error: null, canRetry: false });
    let image: LocalStoryImage | null;
    try {
      image = await this.deps.selector.select();
    } catch (error: unknown) {
      if (!this.isCurrent(generation)) return;
      this.busy = false;
      this.publish({ phase: 'error', error: asStoriesError(error), canRetry: false });
      return;
    }
    if (!this.isCurrent(generation)) return;
    if (image === null) {
      this.busy = false;
      this.publish({ phase: 'idle', error: null, canRetry: false });
      return;
    }
    let storyId: string;
    try {
      storyId = this.deps.createStoryId.execute();
    } catch (error: unknown) {
      this.busy = false;
      this.publish({ phase: 'error', error: asStoriesError(error), canRetry: false });
      return;
    }
    this.attempt = { storyId, image, ticket: null, uploaded: false };
    await this.run(generation);
  }

  // Continues the failed intention with the same Story id (and ticket, if any).
  async retry(): Promise<void> {
    if (this.busy || this.disposed || this.attempt === null || !this.state.canRetry) return;
    this.busy = true;
    await this.run(++this.generation);
  }

  // Drops a failed intention; the next "+" starts a new one with a new id.
  discard(): void {
    if (this.busy || this.disposed) return;
    this.attempt = null;
    this.publish({ phase: 'idle', error: null, canRetry: false });
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.listeners.clear();
  }

  private async run(generation: number): Promise<void> {
    const attempt = this.attempt;
    if (attempt === null) { this.busy = false; return; }
    let published: PublishedStory | null = null;
    try {
      if (attempt.ticket === null && !attempt.uploaded) {
        this.publish({ phase: 'preparing', error: null, canRetry: false });
        try {
          attempt.ticket = await this.deps.prepare.execute(this.ownerUserId, attempt.storyId, attempt.image);
        } catch (error: unknown) {
          // Only a published Story takes an id: an earlier try of THIS intention got
          // through, so the remaining step is the (idempotent) publish.
          if (!(error instanceof StoriesError) || error.code !== 'story-id-conflict') throw error;
          attempt.uploaded = true;
        }
        if (!this.isCurrent(generation)) return;
      }
      if (!attempt.uploaded && attempt.ticket !== null) {
        this.publish({ phase: 'uploading', error: null, canRetry: false });
        try {
          await this.deps.upload.execute(attempt.image, attempt.ticket);
          if (!this.isCurrent(generation)) return;
          attempt.uploaded = true;
        } catch (error: unknown) {
          if (!this.isCurrent(generation)) return;
          if (!(error instanceof StoriesError) || error.code !== 'upload-unavailable') throw error;
          // The transfer may have stored the object anyway: reconcile with ONE publish
          // (media-not-ready then means a later retry uploads again, same id and path).
        }
      }
      this.publish({ phase: 'publishing', error: null, canRetry: false });
      published = await this.deps.publish.execute(this.ownerUserId, {
        storyId: attempt.storyId,
        path: attempt.ticket?.path ?? storyImagePathFor(this.ownerUserId, attempt.storyId, attempt.image.contentType),
      });
      if (!this.isCurrent(generation)) return;
      this.attempt = null;
      this.publish({ phase: 'success', error: null, canRetry: false });
    } catch (error: unknown) {
      if (!this.isCurrent(generation)) return;
      const failure = asStoriesError(error);
      this.publish({ phase: 'error', error: failure, canRetry: RETRYABLE.has(failure.code) });
    } finally {
      if (this.isCurrent(generation)) this.busy = false;
    }
    // Exactly once per intention: the attempt was cleared above.
    if (published !== null && this.isCurrent(generation)) this.onPublished(published);
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private publish(next: StoryPublicationState): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }
}

function asStoriesError(error: unknown): StoriesError {
  return error instanceof StoriesError ? error : new StoriesError('unavailable');
}
