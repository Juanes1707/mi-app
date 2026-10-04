import type { AuthorizedPostMedia } from '@/features/post-media/domain/authorized-post-media';
import { PostMediaError } from '@/features/post-media/domain/post-media-error';
import type { PostMediaReadAuthorizer } from '@/features/post-media/infrastructure/post-image-loader';
import type { GetStoryMediaAccess } from '@/features/stories/application/story-use-cases';
import { StoriesError } from '@/features/stories/domain/stories-error';
import { parseStoryImagePath } from '@/features/stories/domain/story-values';

const STORY_MEDIA_CACHE_PREFIX = 'story-media:';

// Cache identity of a Story image inside the SHARED two-level cache: the stable
// imagePath, namespaced by bucket. Never a signed URL.
export function storyMediaCacheKey(imagePath: string): string {
  return `${STORY_MEDIA_CACHE_PREFIX}${imagePath}`;
}

// Adapts the owner-bound Story read capability to the shared image loader. Every
// acquisition asks the backend first, so an expired or hidden Story is refused (and
// its cached bytes purged) before any cache level is used.
export class StoryMediaAuthorizer implements PostMediaReadAuthorizer {
  constructor(private readonly ownerUserId: string, private readonly access: GetStoryMediaAccess) {}

  async execute(cacheKey: string): Promise<AuthorizedPostMedia> {
    const imagePath = cacheKey.startsWith(STORY_MEDIA_CACHE_PREFIX)
      ? cacheKey.slice(STORY_MEDIA_CACHE_PREFIX.length) : null;
    const path = parseStoryImagePath(imagePath);
    if (imagePath === null || path === null) throw new PostMediaError('invalid-request');
    try {
      const media = await this.access.execute(this.ownerUserId, path.storyId);
      if (media.imagePath !== imagePath) throw new PostMediaError('invalid-response');
      return { imagePath: media.imagePath, signedUrl: media.signedUrl, expiresInSeconds: media.expiresInSeconds };
    } catch (error: unknown) {
      if (error instanceof PostMediaError) throw error;
      if (!(error instanceof StoriesError)) throw new PostMediaError('unavailable');
      if (error.code === 'story-not-found') throw new PostMediaError('not-found');
      if (error.code === 'authentication-required' || error.code === 'owner-session-mismatch') {
        throw new PostMediaError('authentication-required');
      }
      if (error.code === 'invalid-response') throw new PostMediaError('invalid-response');
      throw new PostMediaError('unavailable');
    }
  }
}
