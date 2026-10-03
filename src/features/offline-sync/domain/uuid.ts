const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// UUIDs are compared case-insensitively by the backend, so the queue stores one
// canonical (lowercase) spelling to make owner/entity lookups exact.
export function normalizeUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

// Persisted values were written canonical; any other spelling was not written by us.
export function isCanonicalUuid(value: unknown): value is string {
  return normalizeUuid(value) === value;
}
