import { isNullableTimestamp, timestampOrderKey } from './values.ts';

// Generic checks live in values.ts; re-exported so DM functions keep one import.
export {
  hasExactFields, isNullableTimestamp, isRecord, isSameUuid, isTimestamp, isUuid, parseLimit,
  timestampOrderKey,
} from './values.ts';

export function isValidReceiptOrder(deliveredAt: unknown, readAt: unknown): boolean {
  if (!isNullableTimestamp(deliveredAt) || !isNullableTimestamp(readAt)) return false;
  if (readAt === null) return true;
  if (deliveredAt === null) return false;
  const delivered = timestampOrderKey(deliveredAt);
  const read = timestampOrderKey(readAt);
  return delivered !== null && read !== null && read >= delivered;
}

export function compareDescendingPosition(
  leftCreatedAt: string,
  leftId: string,
  rightCreatedAt: string,
  rightId: string,
): number | null {
  const left = timestampOrderKey(leftCreatedAt);
  const right = timestampOrderKey(rightCreatedAt);
  if (left === null || right === null) return null;
  if (left !== right) return left > right ? -1 : 1;
  const leftUuid = leftId.toLowerCase();
  const rightUuid = rightId.toLowerCase();
  return leftUuid > rightUuid ? -1 : leftUuid < rightUuid ? 1 : 0;
}

export function isValidMessageBody(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && [...value].length <= 2000 &&
    !value.includes('\u0000');
}
