// WHATWG URL parsing is required below; the polyfill is idempotent.
import 'react-native-url-polyfill/auto';

import type { AuthorizedPostMedia } from '@/features/post-media/domain/authorized-post-media';
import { PostMediaError } from '@/features/post-media/domain/post-media-error';

// The backend contract (`post-media-read`) currently issues 60-second URLs.
// Anything else means the contract changed, so we fail closed instead of guessing.
export const POST_MEDIA_SIGNED_URL_TTL_SECONDS = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

// Only the properties we consume: an absolute http(s) URL without embedded
// credentials. Storage's internal routing (path layout, token name) is not ours to check.
function isUsableSignedUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.username === '' && url.password === '';
}

export function parseAuthorizedPostMedia(
  value: unknown,
  requestedImagePath: string,
): AuthorizedPostMedia {
  if (!isRecord(value) || !isRecord(value.media)) throw new PostMediaError('invalid-response');
  const dto = value.media;
  if (!isText(dto.imagePath) || dto.imagePath !== requestedImagePath ||
    !isText(dto.signedUrl) || !isUsableSignedUrl(dto.signedUrl) ||
    typeof dto.expiresInSeconds !== 'number' || !Number.isInteger(dto.expiresInSeconds) ||
    dto.expiresInSeconds <= 0 || dto.expiresInSeconds !== POST_MEDIA_SIGNED_URL_TTL_SECONDS) {
    throw new PostMediaError('invalid-response');
  }
  return {
    imagePath: dto.imagePath,
    signedUrl: dto.signedUrl,
    expiresInSeconds: dto.expiresInSeconds,
  };
}
