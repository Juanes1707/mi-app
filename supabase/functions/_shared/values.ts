// Generic request/RPC value checks shared by Edge Functions (no feature knowledge).
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasExactFields(value: Record<string, unknown>, fields: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isSameUuid(value: unknown, expected: string): value is string {
  return isUuid(value) && value.toLowerCase() === expected.toLowerCase();
}

// Total order key of a PostgreSQL timestamptz spelling in MICROSECONDS (bigint), so two
// instants in the same millisecond still compare correctly.
export function timestampOrderKey(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[9] ?? 0);
  const offsetMinute = Number(match[10] ?? 0);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const epochMilliseconds = Date.parse(value);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 ||
      minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 ||
      !Number.isFinite(epochMilliseconds)) return null;
  const fraction = (match[7] ?? '').padEnd(6, '0');
  return BigInt(epochMilliseconds) * 1000n + BigInt(Number(fraction.slice(3, 6)));
}

export function isTimestamp(value: unknown): value is string {
  return timestampOrderKey(value) !== null;
}

export function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

export function parseLimit(value: string | undefined, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const limit = Number(value);
  return Number.isSafeInteger(limit) && limit <= 50 ? limit : null;
}
