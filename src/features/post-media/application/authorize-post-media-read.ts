import type { AuthorizedPostMedia } from '@/features/post-media/domain/authorized-post-media';
import { PostMediaError } from '@/features/post-media/domain/post-media-error';
import type { PostMediaRepository } from '@/features/post-media/domain/post-media-repository';

export class AuthorizePostMediaRead {
  constructor(private readonly repository: PostMediaRepository) {}

  async execute(imagePath: string): Promise<AuthorizedPostMedia> {
    if (imagePath.trim() === '' || imagePath.trim() !== imagePath) {
      throw new PostMediaError('invalid-request');
    }
    return this.repository.authorizeRead(imagePath);
  }
}
