import { withSupabase } from 'npm:@supabase/server@1';

import { hasImageObjectMetadata, parseSignedUrl } from '../_shared/storage-capabilities.ts';
import {
  buildStoryImagePath, isStoryContentType, MAX_STORY_IMAGE_BYTES, parseStoryImagePath,
  STORY_MEDIA_BUCKET, type StoryContentType,
} from '../_shared/story-values.ts';
import { hasExactFields, isRecord, isUuid } from '../_shared/values.ts';

type PrepareValidation =
  | { ok: true; storyId: string; contentType: StoryContentType }
  | { ok: false; response: Response };

const PREPARE_FIELDS = new Set(['storyId', 'contentType', 'sizeBytes']);
const PREPARE_ROW_FIELDS = new Set(['status', 'story_id']);
const PREPARE_STATUSES = new Set(['ok', 'invalid_request', 'profile_not_ready', 'story_id_conflict']);
const READ_QUERY_FIELDS = new Set(['storyId']);
const MEDIA_ROW_FIELDS = new Set(['status', 'story_id', 'image_path']);
const MEDIA_STATUSES = new Set(['ok', 'invalid_request', 'profile_not_ready', 'story_not_found']);
// Short-lived read capability: the stable identity is imagePath, never this URL.
const SIGNED_URL_TTL_SECONDS = 60;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}
function invalidUploadResponse(): Response {
  return errorResponse(400, 'invalid_story_media_request', 'A valid story image upload request is required.');
}
function invalidReadResponse(): Response {
  return errorResponse(400, 'invalid_story_media_read_request', 'A valid story id is required.');
}
function profileNotReadyResponse(): Response {
  return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
}
function storyIdConflictResponse(): Response {
  return errorResponse(409, 'story_id_conflict', 'This story id is already used.');
}
function storyNotFoundResponse(): Response {
  return errorResponse(404, 'story_not_found', 'Story not found.');
}
function uploadUnavailableResponse(): Response {
  return errorResponse(500, 'story_media_upload_unavailable', 'Unable to prepare story image upload.');
}
function readFailedResponse(): Response {
  return errorResponse(500, 'story_media_read_failed', 'Unable to load story media.');
}
function methodNotAllowedResponse(): Response {
  return Response.json({ code: 'method_not_allowed', message: 'Method not allowed.' },
    { status: 405, headers: { Allow: 'GET, POST, OPTIONS' } });
}

async function validatePrepare(request: Request): Promise<PrepareValidation> {
  let body: unknown;
  try { body = await request.json(); } catch { return { ok: false, response: invalidUploadResponse() }; }
  if (!isRecord(body) || !hasExactFields(body, PREPARE_FIELDS) || !isUuid(body.storyId) ||
      !isStoryContentType(body.contentType) || typeof body.sizeBytes !== 'number' ||
      !Number.isSafeInteger(body.sizeBytes) || body.sizeBytes <= 0 || body.sizeBytes > MAX_STORY_IMAGE_BYTES) {
    return { ok: false, response: invalidUploadResponse() };
  }
  return { ok: true, storyId: body.storyId.toLowerCase(), contentType: body.contentType };
}

function readStoryId(request: Request): string | null {
  const params = new URL(request.url).searchParams;
  const ids = params.getAll('storyId');
  if ([...params.keys()].some((key) => !READ_QUERY_FIELDS.has(key)) || ids.length !== 1) return null;
  const storyId = ids[0];
  return isUuid(storyId) ? storyId.toLowerCase() : null;
}

function parsePrepareResult(value: unknown, storyId: string): string | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row: unknown = value[0];
  if (!isRecord(row) || !hasExactFields(row, PREPARE_ROW_FIELDS) ||
      typeof row.status !== 'string' || !PREPARE_STATUSES.has(row.status)) return null;
  if (row.status !== 'ok') return row.story_id === null ? row.status : null;
  return isUuid(row.story_id) && row.story_id.toLowerCase() === storyId ? 'ok' : null;
}

// The signed upload is scoped to exactly the path we built (upsert disabled).
function parseUploadCapability(value: unknown, expectedPath: string): { path: string; token: string } | null {
  if (!isRecord(value) || parseSignedUrl(value) === null || value.path !== expectedPath ||
      typeof value.token !== 'string' || value.token.trim() === '') return null;
  return { path: value.path, token: value.token };
}

type MediaResult =
  | { status: 'ok'; imagePath: string; contentType: StoryContentType }
  | { status: 'invalid_request' }
  | { status: 'profile_not_ready' }
  | { status: 'story_not_found' };

function parseMediaResult(value: unknown, storyId: string): MediaResult | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row: unknown = value[0];
  if (!isRecord(row) || !hasExactFields(row, MEDIA_ROW_FIELDS) ||
      typeof row.status !== 'string' || !MEDIA_STATUSES.has(row.status)) return null;
  if (row.status !== 'ok') {
    return row.story_id === null && row.image_path === null
      ? { status: row.status as 'invalid_request' | 'profile_not_ready' | 'story_not_found' }
      : null;
  }
  const path = parseStoryImagePath(row.image_path);
  if (!isUuid(row.story_id) || row.story_id.toLowerCase() !== storyId || path === null ||
      path.storyId !== storyId || typeof row.image_path !== 'string') return null;
  return { status: 'ok', imagePath: row.image_path, contentType: path.contentType };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowedResponse();
    const claimedActorId = context.userClaims?.id;
    if (!isUuid(claimedActorId)) return errorResponse(401, 'unauthorized', 'Unauthorized.');
    const actorId = claimedActorId.toLowerCase();

    if (request.method === 'POST') {
      const validation = await validatePrepare(request);
      if (!validation.ok) return validation.response;
      const { data, error } = await context.supabaseAdmin.rpc('prepare_story_upload', {
        p_actor_id: actorId, p_story_id: validation.storyId,
      });
      if (error) { console.error('prepare_story_upload RPC failed.'); return uploadUnavailableResponse(); }
      const status = parsePrepareResult(data, validation.storyId);
      if (status === null) { console.error('prepare_story_upload RPC returned an invalid result.'); return uploadUnavailableResponse(); }
      if (status === 'invalid_request') return invalidUploadResponse();
      if (status === 'profile_not_ready') return profileNotReadyResponse();
      if (status === 'story_id_conflict') return storyIdConflictResponse();

      // The client never chooses the path: it is always '<JWT actor>/<storyId>.<ext>'.
      const path = buildStoryImagePath(actorId, validation.storyId, validation.contentType);
      const { data: uploadData, error: uploadError } = await context.supabaseAdmin.storage
        .from(STORY_MEDIA_BUCKET)
        .createSignedUploadUrl(path, { upsert: false });
      if (uploadError) { console.error('Unable to create signed story upload capability.'); return uploadUnavailableResponse(); }
      const capability = parseUploadCapability(uploadData, path);
      if (capability === null) { console.error('Storage returned an invalid signed upload capability.'); return uploadUnavailableResponse(); }
      return Response.json({
        upload: { storyId: validation.storyId, bucket: STORY_MEDIA_BUCKET, path: capability.path, token: capability.token },
      });
    }

    const storyId = readStoryId(request);
    if (storyId === null) return invalidReadResponse();
    const { data, error } = await context.supabaseAdmin.rpc('get_story_media', {
      p_actor_id: actorId, p_story_id: storyId,
    });
    if (error) { console.error('get_story_media RPC failed.'); return readFailedResponse(); }
    const result = parseMediaResult(data, storyId);
    if (result === null) { console.error('get_story_media RPC returned an invalid result.'); return readFailedResponse(); }
    if (result.status === 'invalid_request') return invalidReadResponse();
    if (result.status === 'profile_not_ready') return profileNotReadyResponse();
    // Missing, expired and hidden are one public answer, and no capability is signed.
    if (result.status === 'story_not_found') return storyNotFoundResponse();

    const { data: info, error: infoError } = await context.supabaseAdmin.storage
      .from(STORY_MEDIA_BUCKET)
      .info(result.imagePath);
    if (infoError || !hasImageObjectMetadata(info, result.contentType, MAX_STORY_IMAGE_BYTES)) {
      console.error('Authorized story media is unavailable or invalid.');
      return readFailedResponse();
    }
    const { data: signedData, error: signedError } = await context.supabaseAdmin.storage
      .from(STORY_MEDIA_BUCKET)
      .createSignedUrl(result.imagePath, SIGNED_URL_TTL_SECONDS);
    if (signedError) { console.error('Unable to create a signed story media URL.'); return readFailedResponse(); }
    const signedUrl = parseSignedUrl(signedData);
    if (signedUrl === null) { console.error('Storage returned an invalid signed story media URL.'); return readFailedResponse(); }
    return Response.json({
      media: { storyId, imagePath: result.imagePath, signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS },
    });
  }),
};
