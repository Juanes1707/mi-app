import { parsePostgresTimestamp } from '@/shared/domain/postgres-timestamp';
import { normalizeUuid } from '@/shared/domain/uuid';

export function normalizeDirectUuid(value: unknown): string | null { return normalizeUuid(value); }
export function isValidDirectMessageBody(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && [...value].length <= 2000 &&
    !value.includes('\u0000');
}
export function isDirectTimestamp(value: unknown): value is string {
  return parsePostgresTimestamp(value) !== null;
}
export function isValidReceiptOrder(deliveredAt: string | null, readAt: string | null): boolean {
  if (readAt === null) return deliveredAt === null || isDirectTimestamp(deliveredAt);
  if (deliveredAt === null) return false;
  const delivered = parsePostgresTimestamp(deliveredAt);
  const read = parsePostgresTimestamp(readAt);
  if (delivered === null || read === null) return false;
  return read.epochMilliseconds > delivered.epochMilliseconds ||
    (read.epochMilliseconds === delivered.epochMilliseconds &&
      read.subMillisecondMicroseconds >= delivered.subMillisecondMicroseconds);
}
export function compareDirectPositions(
  left: { createdAt: string; id: string }, right: { createdAt: string; id: string },
): number | null {
  const leftTime = parsePostgresTimestamp(left.createdAt);
  const rightTime = parsePostgresTimestamp(right.createdAt);
  if (leftTime === null || rightTime === null) return null;
  if (leftTime.epochMilliseconds !== rightTime.epochMilliseconds) {
    return leftTime.epochMilliseconds > rightTime.epochMilliseconds ? -1 : 1;
  }
  if (leftTime.subMillisecondMicroseconds !== rightTime.subMillisecondMicroseconds) {
    return leftTime.subMillisecondMicroseconds > rightTime.subMillisecondMicroseconds ? -1 : 1;
  }
  const leftId = left.id.toLowerCase();
  const rightId = right.id.toLowerCase();
  return leftId > rightId ? -1 : leftId < rightId ? 1 : 0;
}
