import {
  hasExactFields, isRecord, isTimestamp, isUuid, parseLimit, timestampOrderKey,
} from './values.ts';

export type ProfileConnectionKind = 'followers' | 'following';
export type ProfileConnectionCursor = { connectedAt: string; userId: string };
export type ProfileConnection = {
  id: string;
  username: string | null;
  displayName: string | null;
  isPrivate: boolean;
  connectedAt: string;
};
export type ProfileConnectionsValidation =
  | {
      ok: true;
      targetUserId: string;
      kind: ProfileConnectionKind;
      limit: number;
      cursor: ProfileConnectionCursor | null;
    }
  | { ok: false };

const QUERY_FIELDS = new Set([
  'userId', 'kind', 'limit', 'beforeCreatedAt', 'beforeUserId',
]);
const ROW_FIELDS = new Set([
  'result_status', 'profile_id', 'username', 'display_name', 'is_private',
  'connection_created_at',
]);
const STATUSES = new Set(['ok', 'invalid_request', 'profile_not_ready', 'profile_not_found']);
const USERNAME_PATTERN = /^[A-Za-z0-9._]{3,30}$/;
export const PROFILE_CONNECTIONS_DEFAULT_LIMIT = 30;

export type ProfileConnectionsRpc = (
  name: 'list_profile_followers' | 'list_profile_following',
  args: {
    p_actor_id: string;
    p_target_id: string;
    p_limit: number;
    p_before_created_at: string | null;
    p_before_user_id: string | null;
  },
) => Promise<{ data: unknown; error: unknown }>;

export function validateProfileConnectionsRequest(request: Request): ProfileConnectionsValidation {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !QUERY_FIELDS.has(key)) ||
      [...QUERY_FIELDS].some((key) => params.getAll(key).length > 1)) return { ok: false };

  const userId = params.get('userId');
  const kind = params.get('kind');
  const limit = parseLimit(params.get('limit') ?? undefined, PROFILE_CONNECTIONS_DEFAULT_LIMIT);
  if (!isUuid(userId) || (kind !== 'followers' && kind !== 'following') || limit === null) {
    return { ok: false };
  }

  const beforeCreatedAt = params.get('beforeCreatedAt');
  const beforeUserId = params.get('beforeUserId');
  if (beforeCreatedAt === null && beforeUserId === null) {
    return { ok: true, targetUserId: userId.toLowerCase(), kind, limit, cursor: null };
  }
  if (!isTimestamp(beforeCreatedAt) || !isUuid(beforeUserId)) return { ok: false };
  return {
    ok: true,
    targetUserId: userId.toLowerCase(),
    kind,
    limit,
    cursor: { connectedAt: beforeCreatedAt, userId: beforeUserId.toLowerCase() },
  };
}

function comparePosition(left: ProfileConnectionCursor, right: ProfileConnectionCursor): number | null {
  const leftTime = timestampOrderKey(left.connectedAt);
  const rightTime = timestampOrderKey(right.connectedAt);
  if (leftTime === null || rightTime === null) return null;
  if (leftTime !== rightTime) return leftTime > rightTime ? -1 : 1;
  return left.userId > right.userId ? -1 : left.userId < right.userId ? 1 : 0;
}

function onlyNullData(row: Record<string, unknown>): boolean {
  return [...ROW_FIELDS].every((field) => field === 'result_status' || row[field] === null);
}

export function parseProfileConnectionsRpcResult(
  value: unknown,
  validation: Extract<ProfileConnectionsValidation, { ok: true }>,
): { status: string; connections: ProfileConnection[] } | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > validation.limit + 1) return null;
  const connections: ProfileConnection[] = [];
  const seen = new Set<string>();
  let previous = validation.cursor;

  for (const item of value) {
    if (!isRecord(item) || !hasExactFields(item, ROW_FIELDS) ||
        typeof item.result_status !== 'string' || !STATUSES.has(item.result_status)) return null;
    if (item.result_status !== 'ok' || onlyNullData(item)) {
      return value.length === 1 && onlyNullData(item)
        ? { status: item.result_status, connections: [] }
        : null;
    }
    if (!isUuid(item.profile_id) || item.profile_id !== item.profile_id.toLowerCase() ||
        (item.username !== null &&
          (typeof item.username !== 'string' || !USERNAME_PATTERN.test(item.username))) ||
        (item.display_name !== null && typeof item.display_name !== 'string') ||
        typeof item.is_private !== 'boolean' || !isTimestamp(item.connection_created_at)) return null;

    const id = item.profile_id;
    if (seen.has(id)) return null;
    seen.add(id);
    const position = { connectedAt: item.connection_created_at, userId: id };
    if (previous !== null) {
      const order = comparePosition(previous, position);
      if (order === null || order >= 0) return null;
    }
    previous = position;
    connections.push({
      id,
      username: item.username,
      displayName: item.display_name,
      isPrivate: item.is_private,
      connectedAt: item.connection_created_at,
    });
  }
  return { status: 'ok', connections };
}

export function buildProfileConnectionsPage(
  connections: ProfileConnection[],
  limit: number,
): { connections: ProfileConnection[]; nextCursor: ProfileConnectionCursor | null } {
  const hasMore = connections.length > limit;
  const page = hasMore ? connections.slice(0, limit) : connections;
  const last = hasMore ? page[page.length - 1] : undefined;
  return {
    connections: page,
    nextCursor: last ? { connectedAt: last.connectedAt, userId: last.id } : null,
  };
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

export async function handleProfileConnectionsRequest(
  request: Request,
  claimedActorId: unknown,
  rpc: ProfileConnectionsRpc,
): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ code: 'method_not_allowed', message: 'Method not allowed.' },
      { status: 405, headers: { Allow: 'GET, OPTIONS' } });
  }
  if (!isUuid(claimedActorId)) return errorResponse(401, 'unauthorized', 'Unauthorized.');
  const validation = validateProfileConnectionsRequest(request);
  if (!validation.ok) {
    return errorResponse(400, 'invalid_profile_connections_request',
      'A valid profile connections request is required.');
  }
  const rpcName = validation.kind === 'followers'
    ? 'list_profile_followers'
    : 'list_profile_following';
  const { data, error } = await rpc(rpcName, {
    p_actor_id: claimedActorId.toLowerCase(),
    p_target_id: validation.targetUserId,
    p_limit: validation.limit + 1,
    p_before_created_at: validation.cursor?.connectedAt ?? null,
    p_before_user_id: validation.cursor?.userId ?? null,
  });
  if (error) {
    console.error(`${rpcName} RPC failed.`);
    return errorResponse(500, 'profile_connections_read_failed',
      'Unable to load profile connections.');
  }
  const result = parseProfileConnectionsRpcResult(data, validation);
  if (result === null) {
    console.error(`${rpcName} RPC returned an invalid result.`);
    return errorResponse(500, 'profile_connections_read_failed',
      'Unable to load profile connections.');
  }
  if (result.status === 'invalid_request') {
    return errorResponse(400, 'invalid_profile_connections_request',
      'A valid profile connections request is required.');
  }
  if (result.status === 'profile_not_ready') {
    return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
  }
  if (result.status === 'profile_not_found') {
    return errorResponse(404, 'profile_not_found', 'Profile not found.');
  }
  return Response.json(buildProfileConnectionsPage(result.connections, validation.limit));
}
