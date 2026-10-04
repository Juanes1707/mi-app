import type {
  LocalStoryImage, PublishedStory, StoriesCursor, StoriesPage, StoryImageInput,
  StoryMediaAccess, StoryTrayCursor, StoryTrayPage, StoryUploadTicket,
} from '@/features/stories/domain/story';
import { StoriesError } from '@/features/stories/domain/stories-error';
import type { StoriesRepository, StoryImageUploader } from '@/features/stories/domain/stories-repository';
import {
  isStoryImageContentType, isStoryTimestamp, MAX_STORY_IMAGE_BYTES, normalizeStoryUuid,
  parseStoryImagePath, STORY_MEDIA_BUCKET, storyImagePathFor,
} from '@/features/stories/domain/story-values';
import type { UuidGenerator } from '@/shared/application/uuid-generator';

export const STORIES_PAGE_SIZE = 20;

export function validateStoryImage(input: StoryImageInput): void {
  if (!isStoryImageContentType(input.contentType) || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new StoriesError('invalid-image');
  }
  if (input.sizeBytes > MAX_STORY_IMAGE_BYTES) throw new StoriesError('image-too-large');
}

// The Story id is born on the device before the upload: the prepared object, every
// retry and the published row share it (it is also the backend's idempotency key).
export class CreateStoryId {
  constructor(private readonly ids: UuidGenerator) {}
  execute(): string {
    const id = normalizeStoryUuid(this.ids.generate());
    if (id === null) throw new StoriesError('unavailable');
    return id;
  }
}

export class GetStoryTrayPage {
  constructor(private readonly repository: StoriesRepository) {}
  execute(ownerUserId: string, cursor: StoryTrayCursor | null, limit = STORIES_PAGE_SIZE): Promise<StoryTrayPage> {
    const owner = requireUuid(ownerUserId);
    if (!validLimit(limit) || (cursor !== null && (typeof cursor.isSelf !== 'boolean' ||
        !isStoryTimestamp(cursor.latestStoryCreatedAt) || normalizeStoryUuid(cursor.authorId) === null))) {
      throw new StoriesError('invalid-request');
    }
    return this.repository.getTrayPage(owner, limit, cursor);
  }
}

export class GetStoriesPage {
  constructor(private readonly repository: StoriesRepository) {}
  execute(ownerUserId: string, authorId: string, cursor: StoriesCursor | null, limit = STORIES_PAGE_SIZE): Promise<StoriesPage> {
    const owner = requireUuid(ownerUserId);
    const author = requireUuid(authorId);
    if (!validLimit(limit) || (cursor !== null &&
        (!isStoryTimestamp(cursor.createdAt) || normalizeStoryUuid(cursor.storyId) === null))) {
      throw new StoriesError('invalid-request');
    }
    return this.repository.getStoriesPage(owner, author, limit, cursor);
  }
}

export class PrepareStoryImageUpload {
  constructor(private readonly repository: StoriesRepository) {}
  execute(ownerUserId: string, storyId: string, image: StoryImageInput): Promise<StoryUploadTicket> {
    const owner = requireUuid(ownerUserId);
    const story = requireUuid(storyId);
    validateStoryImage(image);
    return this.repository.prepareStoryImageUpload(owner, story, {
      contentType: image.contentType, sizeBytes: image.sizeBytes,
    });
  }
}

export class UploadStoryImage {
  constructor(private readonly uploader: StoryImageUploader) {}
  execute(image: LocalStoryImage, ticket: StoryUploadTicket): Promise<void> {
    validateStoryImage(image);
    const path = parseStoryImagePath(ticket.path);
    // The bytes must match the object the ticket was issued for (same Story, same MIME).
    if (ticket.bucket !== STORY_MEDIA_BUCKET || path === null || path.storyId !== ticket.storyId ||
        ticket.path !== storyImagePathFor(path.authorId, ticket.storyId, image.contentType)) {
      throw new StoriesError('invalid-request');
    }
    return this.uploader.upload(image, ticket);
  }
}

// Publishing only names the prepared object; the backend verifies it in Storage first.
// A retry with the same id is idempotent and never renews the 24 hours.
export class PublishStory {
  constructor(private readonly repository: StoriesRepository) {}
  execute(ownerUserId: string, ticket: Pick<StoryUploadTicket, 'storyId' | 'path'>): Promise<PublishedStory> {
    const owner = requireUuid(ownerUserId);
    const story = requireUuid(ticket.storyId);
    const path = parseStoryImagePath(ticket.path);
    if (path === null || path.authorId !== owner || path.storyId !== story) {
      throw new StoriesError('invalid-request');
    }
    return this.repository.publishStory(owner, story, ticket.path);
  }
}

// A short-lived signed read for one active, visible Story. Never persisted: the
// stable identity of the media is imagePath.
export class GetStoryMediaAccess {
  constructor(private readonly repository: StoriesRepository) {}
  execute(ownerUserId: string, storyId: string): Promise<StoryMediaAccess> {
    return this.repository.getStoryMediaAccess(requireUuid(ownerUserId), requireUuid(storyId));
  }
}

function requireUuid(value: string): string {
  const id = normalizeStoryUuid(value);
  if (id === null) throw new StoriesError('invalid-request');
  return id;
}
function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 50;
}
