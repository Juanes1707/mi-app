import { withSupabase } from 'npm:@supabase/server@1';

import { hasImageObjectMetadata, isStorageNotFound } from '../_shared/storage-capabilities.ts';
import {
  isStoryExpiry, MAX_STORY_IMAGE_BYTES, parseStoryImagePath, STORY_MEDIA_BUCKET, type StoryContentType,
} from '../_shared/story-values.ts';
import {
  hasExactFields, isRecord, isTimestamp, isUuid, parseLimit, timestampOrderKey,
} from '../_shared/values.ts';

type StoryCursor = { createdAt: string; storyId: string };
type ListValidation =
  | { ok: true; authorId: string; limit: number; cursor: StoryCursor | null }
  | { ok: false; response: Response };
type PublishValidation =
  | { ok: true; storyId: string; imagePath: string; contentType: StoryContentType }
  | { ok: false; response: Response };
type Story = {
  id: string;
  author: { id: string; username: string | null; displayName: string | null };
  imagePath: string;
  createdAt: string;
  expiresAt: string;
};
type PublishedStory = { id: string; authorId: string; imagePath: string; createdAt: string; expiresAt: string };

const QUERY_FIELDS = new Set(['authorId', 'limit', 'afterCreatedAt', 'afterStoryId']);
const PUBLISH_FIELDS = new Set(['storyId', 'imagePath']);
const LIST_ROW_FIELDS = new Set([
  'status', 'story_id', 'author_id', 'author_username', 'author_display_name',
  'image_path', 'created_at', 'expires_at',
]);
const PUBLISH_ROW_FIELDS = new Set(['status', 'story_id', 'author_id', 'image_path', 'created_at', 'expires_at']);
const LIST_STATUSES = new Set(['ok', 'invalid_request', 'profile_not_ready', 'author_not_found']);
const PUBLISH_STATUSES = new Set([
  'created', 'already_created', 'invalid_request', 'profile_not_ready', 'story_id_conflict',
]);
const DEFAULT_LIMIT = 20;
const USERNAME_PATTERN = /^[A-Za-z0-9._]{3,30}$/;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}
function invalidListResponse(): Response {
  return errorResponse(400, 'invalid_stories_request', 'A valid stories request is required.');
}
function invalidPublishResponse(): Response {
  return errorResponse(400, 'invalid_story_publish_request', 'A valid story publication request is required.');
}
function profileNotReadyResponse(): Response {
  return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
}
function authorNotFoundResponse(): Response {
  return errorResponse(404, 'author_not_found', 'Author not found.');
}
function storyMediaNotReadyResponse(): Response {
  return errorResponse(409, 'story_media_not_ready', 'The story image is not ready.');
}
function storyIdConflictResponse(): Response {
  return errorResponse(409, 'story_id_conflict', 'This story id is already used.');
}
function readFailedResponse(): Response {
  return errorResponse(500, 'stories_read_failed', 'Unable to load stories.');
}
function publishFailedResponse(): Response {
  return errorResponse(500, 'story_publish_failed', 'Unable to publish story.');
}
function methodNotAllowedResponse(): Response {
  return Response.json({ code: 'method_not_allowed', message: 'Method not allowed.' },
    { status: 405, headers: { Allow: 'GET, POST, OPTIONS' } });
}

function validateList(request: Request): ListValidation {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !QUERY_FIELDS.has(key)) ||
      [...QUERY_FIELDS].some((key) => params.getAll(key).length > 1)) {
    return { ok: false, response: invalidListResponse() };
  }
  const authorId = params.get('authorId');
  const limit = parseLimit(params.get('limit') ?? undefined, DEFAULT_LIMIT);
  if (!isUuid(authorId) || limit === null) return { ok: false, response: invalidListResponse() };
  const createdAt = params.get('afterCreatedAt');
  const storyId = params.get('afterStoryId');
  if (createdAt === null && storyId === null) {
    return { ok: true, authorId: authorId.toLowerCase(), limit, cursor: null };
  }
  if (!isTimestamp(createdAt) || !isUuid(storyId)) return { ok: false, response: invalidListResponse() };
  return {
    ok: true, authorId: authorId.toLowerCase(), limit,
    cursor: { createdAt, storyId: storyId.toLowerCase() },
  };
}

async function validatePublish(request: Request, actorId: string): Promise<PublishValidation> {
  let body: unknown;
  try { body = await request.json(); } catch { return { ok: false, response: invalidPublishResponse() }; }
  if (!isRecord(body) || !hasExactFields(body, PUBLISH_FIELDS) || !isUuid(body.storyId)) {
    return { ok: false, response: invalidPublishResponse() };
  }
  const storyId = body.storyId.toLowerCase();
  // Only the object prepared for THIS actor and THIS Story can be published.
  const path = parseStoryImagePath(body.imagePath);
  if (path === null || path.authorId !== actorId || path.storyId !== storyId ||
      typeof body.imagePath !== 'string') {
    return { ok: false, response: invalidPublishResponse() };
  }
  return { ok: true, storyId, imagePath: body.imagePath, contentType: path.contentType };
}

// Ascending (createdAt, id): -1 when left comes first. Microsecond precision.
function compareAscending(left: StoryCursor, right: StoryCursor): number | null {
  const leftKey = timestampOrderKey(left.createdAt);
  const rightKey = timestampOrderKey(right.createdAt);
  if (leftKey === null || rightKey === null) return null;
  if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
  return left.storyId < right.storyId ? -1 : left.storyId > right.storyId ? 1 : 0;
}

function onlyNullData(row: Record<string, unknown>, fields: Set<string>): boolean {
  return [...fields].every((field) => field === 'status' || row[field] === null);
}

function parseListResult(value: unknown, request: Extract<ListValidation, { ok: true }>):
  { status: string; stories: Story[] } | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > request.limit + 1) return null;
  const stories: Story[] = [];
  const seen = new Set<string>();
  let previous = request.cursor;
  for (const item of value as unknown[]) {
    if (!isRecord(item) || !hasExactFields(item, LIST_ROW_FIELDS) ||
        typeof item.status !== 'string' || !LIST_STATUSES.has(item.status)) return null;
    if (item.status !== 'ok' || onlyNullData(item, LIST_ROW_FIELDS)) {
      return value.length === 1 && onlyNullData(item, LIST_ROW_FIELDS)
        ? { status: item.status, stories: [] } : null;
    }
    const path = parseStoryImagePath(item.image_path);
    if (!isUuid(item.story_id) || !isUuid(item.author_id) ||
        item.author_id.toLowerCase() !== request.authorId || path === null ||
        path.authorId !== request.authorId || path.storyId !== item.story_id.toLowerCase() ||
        (item.author_username !== null &&
          (typeof item.author_username !== 'string' || !USERNAME_PATTERN.test(item.author_username))) ||
        (item.author_display_name !== null && typeof item.author_display_name !== 'string') ||
        !isTimestamp(item.created_at) || !isTimestamp(item.expires_at) ||
        !isStoryExpiry(item.created_at, item.expires_at) || typeof item.image_path !== 'string') return null;
    const id = item.story_id.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    const position = { createdAt: item.created_at, storyId: id };
    if (previous !== null) {
      const order = compareAscending(previous, position);
      if (order === null || order >= 0) return null;
    }
    previous = position;
    stories.push({
      id,
      author: { id: request.authorId, username: item.author_username, displayName: item.author_display_name },
      imagePath: item.image_path,
      createdAt: item.created_at,
      expiresAt: item.expires_at,
    });
  }
  return { status: 'ok', stories };
}

function parsePublishResult(
  value: unknown,
  actorId: string,
  request: Extract<PublishValidation, { ok: true }>,
): { status: string; story?: PublishedStory } | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row: unknown = value[0];
  if (!isRecord(row) || !hasExactFields(row, PUBLISH_ROW_FIELDS) ||
      typeof row.status !== 'string' || !PUBLISH_STATUSES.has(row.status)) return null;
  if (row.status !== 'created' && row.status !== 'already_created') {
    return onlyNullData(row, PUBLISH_ROW_FIELDS) ? { status: row.status } : null;
  }
  if (!isUuid(row.story_id) || row.story_id.toLowerCase() !== request.storyId ||
      !isUuid(row.author_id) || row.author_id.toLowerCase() !== actorId ||
      row.image_path !== request.imagePath || !isTimestamp(row.created_at) ||
      !isTimestamp(row.expires_at) || !isStoryExpiry(row.created_at, row.expires_at)) return null;
  return {
    status: row.status,
    story: {
      id: request.storyId, authorId: actorId, imagePath: request.imagePath,
      createdAt: row.created_at, expiresAt: row.expires_at,
    },
  };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowedResponse();
    const claimedActorId = context.userClaims?.id;
    if (!isUuid(claimedActorId)) return errorResponse(401, 'unauthorized', 'Unauthorized.');
    const actorId = claimedActorId.toLowerCase();

    if (request.method === 'POST') {
      const validation = await validatePublish(request, actorId);
      if (!validation.ok) return validation.response;

      // The object must really be there, be the promised MIME and within the limit,
      // before the Story row can exist (Storage server API; no business table access).
      const { data: info, error: infoError } = await context.supabaseAdmin.storage
        .from(STORY_MEDIA_BUCKET)
        .info(validation.imagePath);
      if (infoError) {
        if (isStorageNotFound(infoError)) return storyMediaNotReadyResponse();
        console.error('Unable to inspect story media.');
        return publishFailedResponse();
      }
      if (!hasImageObjectMetadata(info, validation.contentType, MAX_STORY_IMAGE_BYTES)) {
        return storyMediaNotReadyResponse();
      }

      const { data, error } = await context.supabaseAdmin.rpc('publish_story', {
        p_actor_id: actorId, p_story_id: validation.storyId, p_image_path: validation.imagePath,
      });
      if (error) { console.error('publish_story RPC failed.'); return publishFailedResponse(); }
      const result = parsePublishResult(data, actorId, validation);
      if (result === null) { console.error('publish_story RPC returned an invalid result.'); return publishFailedResponse(); }
      if (result.status === 'invalid_request') return invalidPublishResponse();
      if (result.status === 'profile_not_ready') return profileNotReadyResponse();
      if (result.status === 'story_id_conflict') return storyIdConflictResponse();
      return Response.json({ story: result.story }, { status: result.status === 'created' ? 201 : 200 });
    }

    const validation = validateList(request);
    if (!validation.ok) return validation.response;
    const { data, error } = await context.supabaseAdmin.rpc('list_active_stories', {
      p_actor_id: actorId, p_author_id: validation.authorId, p_limit: validation.limit + 1,
      p_after_created_at: validation.cursor?.createdAt ?? null,
      p_after_story_id: validation.cursor?.storyId ?? null,
    });
    if (error) { console.error('list_active_stories RPC failed.'); return readFailedResponse(); }
    const result = parseListResult(data, validation);
    if (result === null) { console.error('list_active_stories RPC returned an invalid result.'); return readFailedResponse(); }
    if (result.status === 'invalid_request') return invalidListResponse();
    if (result.status === 'profile_not_ready') return profileNotReadyResponse();
    if (result.status === 'author_not_found') return authorNotFoundResponse();
    const hasMore = result.stories.length > validation.limit;
    const stories = hasMore ? result.stories.slice(0, validation.limit) : result.stories;
    const last = hasMore ? stories[stories.length - 1] : undefined;
    const nextCursor = last ? { createdAt: last.createdAt, storyId: last.id } : null;
    return Response.json({ stories, nextCursor });
  }),
};
