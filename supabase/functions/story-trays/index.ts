import { withSupabase } from 'npm:@supabase/server@1';

import {
  hasExactFields, isRecord, isTimestamp, isUuid, parseLimit, timestampOrderKey,
} from '../_shared/values.ts';

// The cursor carries every ordering dimension, so a page boundary between the self tray
// and the followed accounts (or inside a timestamp tie) continues exactly.
type TrayCursor = { isSelf: boolean; latestStoryCreatedAt: string; authorId: string };
type TrayValidation =
  | { ok: true; limit: number; cursor: TrayCursor | null }
  | { ok: false; response: Response };
type StoryTray = {
  author: { id: string; username: string | null; displayName: string | null };
  latestStoryCreatedAt: string;
  activeStoryCount: number;
  isSelf: boolean;
};

const QUERY_FIELDS = new Set(['limit', 'beforeIsSelf', 'beforeLatestStoryCreatedAt', 'beforeAuthorId']);
const ROW_FIELDS = new Set([
  'status', 'author_id', 'author_username', 'author_display_name',
  'latest_story_created_at', 'active_story_count', 'is_self',
]);
const STATUSES = new Set(['ok', 'invalid_request', 'profile_not_ready']);
const DEFAULT_LIMIT = 20;
const USERNAME_PATTERN = /^[A-Za-z0-9._]{3,30}$/;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}
function invalidResponse(): Response {
  return errorResponse(400, 'invalid_story_trays_request', 'A valid story trays request is required.');
}
function profileNotReadyResponse(): Response {
  return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
}
function readFailedResponse(): Response {
  return errorResponse(500, 'story_trays_read_failed', 'Unable to load stories.');
}
function methodNotAllowedResponse(): Response {
  return Response.json({ code: 'method_not_allowed', message: 'Method not allowed.' },
    { status: 405, headers: { Allow: 'GET, OPTIONS' } });
}

function validate(request: Request, actorId: string): TrayValidation {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !QUERY_FIELDS.has(key)) ||
      [...QUERY_FIELDS].some((key) => params.getAll(key).length > 1)) {
    return { ok: false, response: invalidResponse() };
  }
  const limit = parseLimit(params.get('limit') ?? undefined, DEFAULT_LIMIT);
  if (limit === null) return { ok: false, response: invalidResponse() };
  const isSelf = params.get('beforeIsSelf');
  const latest = params.get('beforeLatestStoryCreatedAt');
  const authorId = params.get('beforeAuthorId');
  if (isSelf === null && latest === null && authorId === null) return { ok: true, limit, cursor: null };
  if ((isSelf !== 'true' && isSelf !== 'false') || !isTimestamp(latest) || !isUuid(authorId) ||
      // A self cursor can only name the actor, and the actor is only ever the self tray.
      (isSelf === 'true') !== (authorId.toLowerCase() === actorId)) {
    return { ok: false, response: invalidResponse() };
  }
  return {
    ok: true, limit,
    cursor: { isSelf: isSelf === 'true', latestStoryCreatedAt: latest, authorId: authorId.toLowerCase() },
  };
}

// Total order: isSelf DESC, latestStoryCreatedAt DESC, authorId DESC. -1 when left comes first.
function compareTrays(left: TrayCursor, right: TrayCursor): number | null {
  if (left.isSelf !== right.isSelf) return left.isSelf ? -1 : 1;
  const leftKey = timestampOrderKey(left.latestStoryCreatedAt);
  const rightKey = timestampOrderKey(right.latestStoryCreatedAt);
  if (leftKey === null || rightKey === null) return null;
  if (leftKey !== rightKey) return leftKey > rightKey ? -1 : 1;
  return left.authorId > right.authorId ? -1 : left.authorId < right.authorId ? 1 : 0;
}

function onlyNullData(row: Record<string, unknown>): boolean {
  return [...ROW_FIELDS].every((field) => field === 'status' || row[field] === null);
}

function parseResult(value: unknown, request: Extract<TrayValidation, { ok: true }>, actorId: string):
  { status: string; trays: StoryTray[] } | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > request.limit + 1) return null;
  const trays: StoryTray[] = [];
  const seen = new Set<string>();
  let previous = request.cursor;
  for (const item of value as unknown[]) {
    if (!isRecord(item) || !hasExactFields(item, ROW_FIELDS) ||
        typeof item.status !== 'string' || !STATUSES.has(item.status)) return null;
    if (item.status !== 'ok' || onlyNullData(item)) {
      return value.length === 1 && onlyNullData(item) ? { status: item.status, trays: [] } : null;
    }
    if (!isUuid(item.author_id) || typeof item.is_self !== 'boolean' ||
        item.is_self !== (item.author_id.toLowerCase() === actorId) ||
        (item.author_username !== null &&
          (typeof item.author_username !== 'string' || !USERNAME_PATTERN.test(item.author_username))) ||
        (item.author_display_name !== null && typeof item.author_display_name !== 'string') ||
        !isTimestamp(item.latest_story_created_at) || typeof item.active_story_count !== 'number' ||
        !Number.isSafeInteger(item.active_story_count) || item.active_story_count < 1) return null;
    const authorId = item.author_id.toLowerCase();
    if (seen.has(authorId)) return null;
    seen.add(authorId);
    const position = { isSelf: item.is_self, latestStoryCreatedAt: item.latest_story_created_at, authorId };
    if (previous !== null) {
      const order = compareTrays(previous, position);
      if (order === null || order >= 0) return null;
    }
    previous = position;
    trays.push({
      author: { id: authorId, username: item.author_username, displayName: item.author_display_name },
      latestStoryCreatedAt: item.latest_story_created_at,
      activeStoryCount: item.active_story_count,
      isSelf: item.is_self,
    });
  }
  return { status: 'ok', trays };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'GET') return methodNotAllowedResponse();
    const claimedActorId = context.userClaims?.id;
    if (!isUuid(claimedActorId)) return errorResponse(401, 'unauthorized', 'Unauthorized.');
    const actorId = claimedActorId.toLowerCase();

    const validation = validate(request, actorId);
    if (!validation.ok) return validation.response;
    const { data, error } = await context.supabaseAdmin.rpc('list_story_trays', {
      p_actor_id: actorId, p_limit: validation.limit + 1,
      p_before_is_self: validation.cursor?.isSelf ?? null,
      p_before_latest_created_at: validation.cursor?.latestStoryCreatedAt ?? null,
      p_before_author_id: validation.cursor?.authorId ?? null,
    });
    if (error) { console.error('list_story_trays RPC failed.'); return readFailedResponse(); }
    const result = parseResult(data, validation, actorId);
    if (result === null) { console.error('list_story_trays RPC returned an invalid result.'); return readFailedResponse(); }
    if (result.status === 'invalid_request') return invalidResponse();
    if (result.status === 'profile_not_ready') return profileNotReadyResponse();
    const hasMore = result.trays.length > validation.limit;
    const trays = hasMore ? result.trays.slice(0, validation.limit) : result.trays;
    const last = hasMore ? trays[trays.length - 1] : undefined;
    const nextCursor = last
      ? { isSelf: last.isSelf, latestStoryCreatedAt: last.latestStoryCreatedAt, authorId: last.author.id }
      : null;
    return Response.json({ trays, nextCursor });
  }),
};
