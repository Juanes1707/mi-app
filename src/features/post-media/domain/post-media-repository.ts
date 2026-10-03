import type { AuthorizedPostMedia } from './authorized-post-media';

export interface PostMediaRepository {
  authorizeRead(imagePath: string): Promise<AuthorizedPostMedia>;
}
