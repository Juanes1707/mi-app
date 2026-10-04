import { File } from 'expo-file-system';

import { validatePostMedia } from '@/features/post-create/application/post-create-use-cases';
import type { LocalPostImage, PostMediaUploadTicket } from '@/features/post-create/domain/models';
import type { LocalPostImageInspector, PostMediaUploader } from '@/features/post-create/domain/ports';
import { PostCreateError } from '@/features/post-create/domain/post-create-error';
import { readLocalFileBytes, uploadWithSignedCapability } from '@/shared/infrastructure/signed-storage-upload';

// The only Storage exception: upload bytes using a backend-issued, object-scoped capability.
export class SignedPostMediaUploader implements PostMediaUploader, LocalPostImageInspector {
  inspect(uri: string, mimeType?: string): LocalPostImage {
    try {
      if (!/^(file|content):\/\//i.test(uri)) throw new PostCreateError('invalid-image');
      const file = new File(uri);
      if (!file.exists) throw new PostCreateError('invalid-image');
      const contentType = mimeType || file.type;
      if (contentType !== 'image/jpeg' && contentType !== 'image/png' && contentType !== 'image/webp') {
        throw new PostCreateError('invalid-image');
      }
      const image: LocalPostImage = { uri, contentType, fileSize: file.size };
      validatePostMedia(image);
      return image;
    } catch (error: unknown) {
      throw error instanceof PostCreateError ? error : new PostCreateError('invalid-image');
    }
  }

  async upload(image: LocalPostImage, ticket: PostMediaUploadTicket): Promise<void> {
    let bytes: ArrayBuffer;
    try {
      const current = this.inspect(image.uri, image.contentType);
      if (current.fileSize !== image.fileSize) throw new PostCreateError('invalid-image');
      const read = await readLocalFileBytes(image.uri, current.fileSize);
      if (read === null) throw new PostCreateError('invalid-image');
      bytes = read;
    } catch (error: unknown) {
      throw error instanceof PostCreateError ? error : new PostCreateError('invalid-image');
    }
    if (!(await uploadWithSignedCapability(ticket, bytes, image.contentType))) {
      throw new PostCreateError('upload-unavailable');
    }
  }
}
