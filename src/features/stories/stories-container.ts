import type { ImageRef } from 'expo-image';
import { openDatabaseAsync } from 'expo-sqlite';

import type { PostImageSource } from '@/features/post-media/application/post-image-request';
import { createAuthorizedImageSource } from '@/features/post-media/post-media-container';
import type { StoryPublicationDependencies } from '@/features/stories/application/story-publication-controller';
import { StorySeenTracker } from '@/features/stories/application/story-seen-tracker';
import {
  CreateStoryId, GetStoriesPage, GetStoryMediaAccess, GetStoryTrayPage, PrepareStoryImageUpload,
  PublishStory, UploadStoryImage,
} from '@/features/stories/application/story-use-cases';
import { BackendStoriesRepository } from '@/features/stories/data/backend-stories-repository';
import { ExpoStoryImageSelector } from '@/features/stories/data/expo-story-image-selector';
import { SignedStoryImageUploader } from '@/features/stories/data/signed-story-image-uploader';
import { SQLiteStorySeenStore } from '@/features/stories/data/sqlite-story-seen-store';
import { StoryMediaAuthorizer } from '@/features/stories/data/story-media-authorizer';
import {
  prepareStoriesLocalDatabase, STORIES_LOCAL_DATABASE_NAME,
} from '@/features/stories/data/stories-local-database';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';
import { expoUuidGenerator } from '@/shared/infrastructure/expo-uuid-generator';

const repository = new BackendStoriesRepository(authenticatedBackendApiClient);
export const createStoryId = new CreateStoryId(expoUuidGenerator);
export const getStoryTrayPage = new GetStoryTrayPage(repository);
export const getStoriesPage = new GetStoriesPage(repository);
export const prepareStoryImageUpload = new PrepareStoryImageUpload(repository);
export const uploadStoryImage = new UploadStoryImage(new SignedStoryImageUploader());
export const publishStory = new PublishStory(repository);
export const getStoryMediaAccess = new GetStoryMediaAccess(repository);

export const storyPublicationDependencies: StoryPublicationDependencies = {
  selector: new ExpoStoryImageSelector(),
  createStoryId,
  prepare: prepareStoryImageUpload,
  upload: uploadStoryImage,
  publish: publishStory,
};

// Local seen state: its own database (never offline-mutations.db), opened lazily.
export const storySeenTracker = new StorySeenTracker(new SQLiteStorySeenStore(
  async () => prepareStoriesLocalDatabase(await openDatabaseAsync(STORIES_LOCAL_DATABASE_NAME)),
));

// Story images go through the SAME two-level cache as Post media (no second LRU),
// authorized per acquisition for the given owner. One source per owner, so in-flight
// jobs are never shared across accounts.
let imageSource: { ownerUserId: string; source: PostImageSource<ImageRef> } | null = null;
export function storyImageSourceFor(ownerUserId: string): PostImageSource<ImageRef> {
  if (imageSource === null || imageSource.ownerUserId !== ownerUserId) {
    imageSource = {
      ownerUserId,
      source: createAuthorizedImageSource(new StoryMediaAuthorizer(ownerUserId, getStoryMediaAccess)),
    };
  }
  return imageSource.source;
}
