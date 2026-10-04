import type {
  LocalStoryImage, PublishedStory, StoriesCursor, StoriesPage, StoryImageInput,
  StoryMediaAccess, StoryTrayCursor, StoryTrayPage, StoryUploadTicket,
} from '@/features/stories/domain/story';

// Every call is bound to the expected owner: a token of another session is never used.
export interface StoriesRepository {
  getTrayPage(expectedOwnerUserId: string, limit: number, cursor: StoryTrayCursor | null): Promise<StoryTrayPage>;
  getStoriesPage(
    expectedOwnerUserId: string, authorId: string, limit: number, cursor: StoriesCursor | null,
  ): Promise<StoriesPage>;
  prepareStoryImageUpload(
    expectedOwnerUserId: string, storyId: string, image: StoryImageInput,
  ): Promise<StoryUploadTicket>;
  publishStory(expectedOwnerUserId: string, storyId: string, imagePath: string): Promise<PublishedStory>;
  getStoryMediaAccess(expectedOwnerUserId: string, storyId: string): Promise<StoryMediaAccess>;
}

// Raw bytes go straight to Storage, but only with a backend-issued capability.
export interface StoryImageUploader {
  upload(image: LocalStoryImage, ticket: StoryUploadTicket): Promise<void>;
}

// Picks ONE static image from the device library; null when the user cancels.
export interface StoryImageSelector {
  select(): Promise<LocalStoryImage | null>;
}
