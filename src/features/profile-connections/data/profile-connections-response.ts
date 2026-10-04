import type {
  ProfileConnection, ProfileConnectionsCursor, ProfileConnectionsPage,
} from '@/features/profile-connections/domain/profile-connection';
import {
  comparePostgresTimestamps, parsePostgresTimestamp,
} from '@/shared/domain/postgres-timestamp';
import { normalizeUuid } from '@/shared/domain/uuid';

const USERNAME_PATTERN = /^[A-Za-z0-9._]{3,30}$/;

export function parseProfileConnectionsPage(
  value: unknown,
  expected: { limit: number; cursor: ProfileConnectionsCursor | null },
): ProfileConnectionsPage | null {
  if (!hasExactFields(value, ['connections', 'nextCursor']) || !Array.isArray(value.connections) ||
      value.connections.length > expected.limit) return null;
  const connections: ProfileConnection[] = [];
  const seen = new Set<string>();
  let previous = expected.cursor;
  for (const item of value.connections) {
    if (!hasExactFields(item, ['id', 'username', 'displayName', 'isPrivate', 'connectedAt'])) return null;
    const id = normalizeUuid(item.id);
    if (id === null || id !== item.id || seen.has(id) ||
        (item.username !== null &&
          (typeof item.username !== 'string' || !USERNAME_PATTERN.test(item.username))) ||
        (item.displayName !== null && typeof item.displayName !== 'string') ||
        typeof item.isPrivate !== 'boolean' || parsePostgresTimestamp(item.connectedAt) === null) return null;
    seen.add(id);
    const connectedAt = item.connectedAt as string;
    const position: ProfileConnectionsCursor = { connectedAt, userId: id };
    if (previous !== null) {
      const order = comparePositions(previous, position);
      if (order === null || order >= 0) return null;
    }
    previous = position;
    connections.push({
      id,
      username: item.username,
      displayName: item.displayName,
      isPrivate: item.isPrivate,
      connectedAt,
    });
  }
  const nextCursor = parseCursor(value.nextCursor);
  if (nextCursor === undefined) return null;
  const last = connections[connections.length - 1];
  if (nextCursor !== null && (connections.length !== expected.limit || last === undefined ||
      nextCursor.connectedAt !== last.connectedAt || nextCursor.userId !== last.id)) return null;
  return { connections, nextCursor };
}

function comparePositions(left: ProfileConnectionsCursor, right: ProfileConnectionsCursor): number | null {
  const leftTime = parsePostgresTimestamp(left.connectedAt);
  const rightTime = parsePostgresTimestamp(right.connectedAt);
  if (leftTime === null || rightTime === null) return null;
  const byTime = comparePostgresTimestamps(rightTime, leftTime);
  if (byTime !== 0) return byTime;
  return left.userId > right.userId ? -1 : left.userId < right.userId ? 1 : 0;
}

function parseCursor(value: unknown): ProfileConnectionsCursor | null | undefined {
  if (value === null) return null;
  if (!hasExactFields(value, ['connectedAt', 'userId']) ||
      parsePostgresTimestamp(value.connectedAt) === null) return undefined;
  const userId = normalizeUuid(value.userId);
  return userId === null || userId !== value.userId
    ? undefined
    : { connectedAt: value.connectedAt as string, userId };
}

function hasExactFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}
