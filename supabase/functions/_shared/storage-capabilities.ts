import { isRecord } from './values.ts';

// Storage builds a signed read capability from an authorized object path; only the
// shape we consume is checked (absolute http(s), no embedded credentials), not
// Storage's internal URL layout.
export function parseSignedUrl(value: unknown): string | null {
  if (
    !isRecord(value) ||
    typeof value.signedUrl !== 'string' ||
    value.signedUrl.trim() === ''
  ) {
    return null;
  }

  let signedUrl: URL;

  try {
    signedUrl = new URL(value.signedUrl);
  } catch {
    return null;
  }

  if (
    (signedUrl.protocol !== 'https:' && signedUrl.protocol !== 'http:') ||
    signedUrl.username !== '' ||
    signedUrl.password !== ''
  ) {
    return null;
  }

  return value.signedUrl;
}

// Storage object metadata (from `info(path)`) of an uploaded image: a real, non-empty
// object within the size limit whose MIME is exactly the one the path promises.
export function hasImageObjectMetadata(value: unknown, expectedContentType: string, maxBytes: number): boolean {
  if (!isRecord(value)) return false;
  const size = value.size;
  return typeof size === 'number' && Number.isInteger(size) && size > 0 && size <= maxBytes &&
    value.contentType === expectedContentType;
}

export function isStorageNotFound(error: unknown): boolean {
  return isRecord(error) && (error.status === 404 || error.statusCode === '404');
}
