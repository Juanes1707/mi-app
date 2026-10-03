import type {
  LocalPostImage, PostMediaInput, PostMediaUploadTicket, PublishPostInput,
} from '@/features/post-create/domain/models';
import type {
  PostImageSelector, PostMediaUploader, PostPublishingRepository,
} from '@/features/post-create/domain/ports';
import { PostCreateError } from '@/features/post-create/domain/post-create-error';

export const MAX_POST_IMAGE_SIZE = 10 * 1024 * 1024;

export function validatePostMedia(input: PostMediaInput): void {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(input.contentType) ||
    !Number.isInteger(input.fileSize) || input.fileSize <= 0) {
    throw new PostCreateError('invalid-image');
  }
  if (input.fileSize > MAX_POST_IMAGE_SIZE) throw new PostCreateError('image-too-large');
}
export function validatePostPublication(input: PublishPostInput): void {
  if (!input.imagePath.trim()) throw new PostCreateError('invalid-image');
  if (input.caption.length > 2200) throw new PostCreateError('invalid-caption');
}

export class SelectPostImage {
  constructor(private readonly selector: PostImageSelector) {}
  async execute() {
    const image = await this.selector.select();
    if (image) validatePostMedia(image);
    return image;
  }
}
export class PreparePostMediaUpload {
  constructor(private readonly repository: PostPublishingRepository) {}
  execute(input: PostMediaInput) {
    validatePostMedia(input);
    return this.repository.prepareUpload(input);
  }
}
export class UploadPostMedia {
  constructor(private readonly uploader: PostMediaUploader) {}
  execute(image: LocalPostImage, ticket: PostMediaUploadTicket) {
    validatePostMedia(image);
    return this.uploader.upload(image, ticket);
  }
}
export class PublishPost {
  constructor(private readonly repository: PostPublishingRepository) {}
  execute(input: PublishPostInput) {
    validatePostPublication(input);
    return this.repository.publish(input);
  }
}
