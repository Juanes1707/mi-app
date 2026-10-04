import {
  CreateStoryId, GetStoriesPage, GetStoryMediaAccess, GetStoryTrayPage, PrepareStoryImageUpload,
  PublishStory, UploadStoryImage,
} from '@/features/stories/application/story-use-cases';
import { BackendStoriesRepository } from '@/features/stories/data/backend-stories-repository';
import { SignedStoryImageUploader } from '@/features/stories/data/signed-story-image-uploader';
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
