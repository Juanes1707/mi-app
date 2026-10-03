import {
  PreparePostMediaUpload, PublishPost, SelectPostImage, UploadPostMedia,
} from '@/features/post-create/application/post-create-use-cases';
import { BackendPostPublishingRepository } from '@/features/post-create/data/backend-post-publishing-repository';
import { ExpoPostImageSelector } from '@/features/post-create/data/expo-post-image-selector';
import { SignedPostMediaUploader } from '@/features/post-create/data/signed-post-media-uploader';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

const repository = new BackendPostPublishingRepository(authenticatedBackendApiClient);
const mediaAdapter = new SignedPostMediaUploader();
export const selectPostImage = new SelectPostImage(new ExpoPostImageSelector(mediaAdapter));
export const preparePostMediaUpload = new PreparePostMediaUpload(repository);
export const uploadPostMedia = new UploadPostMedia(mediaAdapter);
export const publishPost = new PublishPost(repository);
