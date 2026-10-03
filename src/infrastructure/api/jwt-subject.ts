// Reads the `sub` claim of a JWT WITHOUT verifying its signature.
//
// This is a local consistency guard only ("do not send user A's queued action with a
// token that says it belongs to user B"). It grants nothing: the backend verifies the
// JWT cryptographically (verify_jwt) and derives the actor from it. Never log the
// token or its payload.

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Base64URL (RFC 4648 §5, padding omitted as in JWTs) → bytes.
function decodeBase64Url(segment: string): Uint8Array | null {
  if (!BASE64URL_SEGMENT.test(segment) || segment.length % 4 === 1) return null;
  const bytes = new Uint8Array(Math.floor((segment.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const character of segment) {
    // Only the low (bits + 6) ≤ 14 bits are ever needed.
    buffer = ((buffer << 6) | BASE64URL_ALPHABET.indexOf(character)) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  return bytes;
}

// Strict UTF-8: decodeURIComponent throws on malformed sequences.
function decodeUtf8(bytes: Uint8Array): string | null {
  let encoded = '';
  for (const byte of bytes) encoded += `%${byte.toString(16).padStart(2, '0')}`;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

// Returns the canonical (lowercase) UUID subject, or null when the token is not a
// compact JWT with a JSON object payload whose `sub` is a UUID.
export function readUnverifiedJwtSubject(token: string): string | null {
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => !BASE64URL_SEGMENT.test(segment))) {
    return null;
  }
  const bytes = decodeBase64Url(segments[1]);
  const json = bytes === null ? null : decodeUtf8(bytes);
  if (json === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload) || !('sub' in payload)) {
    return null;
  }
  const subject = payload.sub;
  return typeof subject === 'string' && UUID_PATTERN.test(subject) ? subject.toLowerCase() : null;
}
