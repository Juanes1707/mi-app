import { parsePostgresTimestamp, type PostgresTimestamp } from '@/shared/domain/postgres-timestamp';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}
export function isSameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

// Microsecond-precision instant. Date only keeps milliseconds, so the last three
// fraction digits are kept apart: two comments in the same millisecond still order.
export type CommentTimestamp = PostgresTimestamp;

export function parseCommentTimestamp(value: unknown): CommentTimestamp | null {
  return parsePostgresTimestamp(value);
}

// Server order of a sibling set: (createdAt, id) ascending. UUIDs compare as
// lowercase hex, which matches PostgreSQL's byte order for uuid. Returns null
// when a timestamp is invalid, so callers cannot mistake garbage for "equal".
export function compareCommentPositions(
  left: { createdAt: string; id: string },
  right: { createdAt: string; id: string },
): number | null {
  const leftTime = parseCommentTimestamp(left.createdAt);
  const rightTime = parseCommentTimestamp(right.createdAt);
  if (leftTime === null || rightTime === null) return null;

  if (leftTime.epochMilliseconds !== rightTime.epochMilliseconds) {
    return leftTime.epochMilliseconds < rightTime.epochMilliseconds ? -1 : 1;
  }
  if (leftTime.subMillisecondMicroseconds !== rightTime.subMillisecondMicroseconds) {
    return leftTime.subMillisecondMicroseconds < rightTime.subMillisecondMicroseconds ? -1 : 1;
  }
  const leftId = left.id.toLowerCase();
  const rightId = right.id.toLowerCase();
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}
