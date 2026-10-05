import type {
  LocalPostImage, PostMediaInput, PostMediaUploadTicket, PublishedPost, PublishPostInput,
} from './models';

export interface PostPublishingRepository {
  prepareUpload(input: PostMediaInput): Promise<PostMediaUploadTicket>;
  publish(input: PublishPostInput): Promise<PublishedPost>;
}
export interface PostMediaUploader {
  upload(image: LocalPostImage, ticket: PostMediaUploadTicket): Promise<void>;
}
export interface LocalPostImageInspector {
  inspect(uri: string, mimeType?: string): LocalPostImage;
}
export type PostImageSelectionMode = 'original' | 'crop-square';
export interface PostImageSelector {
  select(mode: PostImageSelectionMode): Promise<LocalPostImage | null>;
}
