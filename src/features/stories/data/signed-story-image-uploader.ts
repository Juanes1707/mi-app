import type { LocalStoryImage, StoryUploadTicket } from '@/features/stories/domain/story';
import { StoriesError } from '@/features/stories/domain/stories-error';
import type { StoryImageUploader } from '@/features/stories/domain/stories-repository';
import { readLocalFileBytes, uploadWithSignedCapability } from '@/shared/infrastructure/signed-storage-upload';

// Storage data plane only: the bytes of a local image go to the single object the
// backend authorized (shared signed-upload transport, same as Posts).
export class SignedStoryImageUploader implements StoryImageUploader {
  async upload(image: LocalStoryImage, ticket: StoryUploadTicket): Promise<void> {
    const bytes = await readLocalFileBytes(image.uri, image.sizeBytes);
    if (bytes === null) throw new StoriesError('invalid-image');
    if (!(await uploadWithSignedCapability(ticket, bytes, image.contentType))) {
      throw new StoriesError('upload-unavailable');
    }
  }
}
