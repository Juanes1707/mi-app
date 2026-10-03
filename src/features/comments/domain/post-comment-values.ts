const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The backend's timestamptz spelling: optional microseconds and Z or a ±hh:mm offset.
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isSameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

// Microsecond-precision instant. Date only keeps milliseconds, so the last three
// fraction digits are kept apart: two comments in the same millisecond still order.
export type CommentTimestamp = {
  epochMilliseconds: number;
  subMillisecondMicroseconds: number;
};

export function parseCommentTimestamp(value: unknown): CommentTimestamp | null {
  if (typeof value !== 'string') return null;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetSign = match[8] === '-' ? -1 : 1;
  const offsetHour = Number(match[9] ?? 0);
  const offsetMinute = Number(match[10] ?? 0);
  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59
  ) return null;

  // Built from components instead of Date.parse: no engine-specific parsing of
  // fractions or offsets, and setUTCFullYear avoids Date.UTC's 0-99 => 19xx rule.
  const fraction = (match[7] ?? '').padEnd(6, '0');
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number(fraction.slice(0, 3)));
  const epochMilliseconds =
    date.getTime() - offsetSign * (offsetHour * 60 + offsetMinute) * 60_000;
  if (!Number.isFinite(epochMilliseconds)) return null;

  return { epochMilliseconds, subMillisecondMicroseconds: Number(fraction.slice(3, 6)) };
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

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
