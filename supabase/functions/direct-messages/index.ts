import { withSupabase } from 'npm:@supabase/server@1';

import {
  MESSAGE_ROW_FIELDS as ROW_FIELDS, onlyNullMessageData as onlyNullData,
  parseDirectMessageRow as parseMessageRow, type DirectMessageDto as Message,
} from '../_shared/direct-message-row.ts';
import {
  compareDescendingPosition, hasExactFields, isRecord, isTimestamp, isUuid, isValidMessageBody, parseLimit,
} from '../_shared/direct-message-values.ts';

type MessageCursor = { createdAt: string; messageId: string };
type ListValidation =
  | { ok: true; conversationId: string; limit: number; cursor: MessageCursor | null }
  | { ok: false; response: Response };
type SendValidation =
  | { ok: true; conversationId: string; messageId: string; body: string }
  | { ok: false; response: Response };

const SEND_FIELDS = new Set(['conversationId', 'messageId', 'body']);
const QUERY_FIELDS = new Set(['conversationId', 'limit', 'beforeCreatedAt', 'beforeMessageId']);
const SEND_STATUSES = new Set([
  'created', 'already_created', 'invalid_request', 'profile_not_ready',
  'conversation_not_found', 'message_id_conflict',
]);
const LIST_STATUSES = new Set(['ok', 'invalid_request', 'profile_not_ready', 'conversation_not_found']);
const DEFAULT_LIMIT = 30;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}
function invalidResponse(): Response {
  return errorResponse(400, 'invalid_direct_message_request', 'A valid direct message request is required.');
}
function conversationNotFoundResponse(): Response {
  return errorResponse(404, 'conversation_not_found', 'Conversation not found.');
}
function profileNotReadyResponse(): Response {
  return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
}
function conflictResponse(): Response {
  return errorResponse(409, 'message_creation_conflict', 'Unable to create message with this identifier.');
}
function sendFailedResponse(): Response {
  return errorResponse(500, 'direct_message_send_failed', 'Unable to send message.');
}
function readFailedResponse(): Response {
  return errorResponse(500, 'direct_messages_read_failed', 'Unable to load messages.');
}
function methodNotAllowedResponse(): Response {
  return Response.json({ code: 'method_not_allowed', message: 'Method not allowed.' },
    { status: 405, headers: { Allow: 'GET, POST, OPTIONS' } });
}

async function validateSend(request: Request): Promise<SendValidation> {
  let body: unknown;
  try { body = await request.json(); } catch { return { ok: false, response: invalidResponse() }; }
  if (!isRecord(body) || !hasExactFields(body, SEND_FIELDS) ||
      !isUuid(body.conversationId) || !isUuid(body.messageId) || !isValidMessageBody(body.body)) {
    return { ok: false, response: invalidResponse() };
  }
  return {
    ok: true, conversationId: body.conversationId.toLowerCase(),
    messageId: body.messageId.toLowerCase(), body: body.body,
  };
}

function validateList(request: Request): ListValidation {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (keys.some((key) => !QUERY_FIELDS.has(key)) ||
      [...QUERY_FIELDS].some((key) => params.getAll(key).length > 1)) {
    return { ok: false, response: invalidResponse() };
  }
  const conversationIds = params.getAll('conversationId');
  const limit = parseLimit(params.get('limit') ?? undefined, DEFAULT_LIMIT);
  if (conversationIds.length !== 1 || !isUuid(conversationIds[0]) || limit === null) {
    return { ok: false, response: invalidResponse() };
  }
  const times = params.getAll('beforeCreatedAt');
  const ids = params.getAll('beforeMessageId');
  if (times.length === 0 && ids.length === 0) {
    return { ok: true, conversationId: conversationIds[0].toLowerCase(), limit, cursor: null };
  }
  if (times.length !== 1 || ids.length !== 1 || !isTimestamp(times[0]) || !isUuid(ids[0])) {
    return { ok: false, response: invalidResponse() };
  }
  return {
    ok: true, conversationId: conversationIds[0].toLowerCase(), limit,
    cursor: { createdAt: times[0], messageId: ids[0].toLowerCase() },
  };
}

function parseSendResult(
  value: unknown,
  actorId: string,
  request: Extract<SendValidation, { ok: true }>,
): { status: string; message?: Message } | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0]) ||
      !hasExactFields(value[0], ROW_FIELDS)) return null;
  const row = value[0];
  if (typeof row.status !== 'string' || !SEND_STATUSES.has(row.status)) return null;
  if (row.status !== 'created' && row.status !== 'already_created') {
    return onlyNullData(row) ? { status: row.status } : null;
  }
  const message = parseMessageRow(row, request.conversationId);
  if (message === null || message.id !== request.messageId ||
      message.senderId !== actorId.toLowerCase() || message.body !== request.body) return null;
  return { status: row.status, message };
}

function parseListResult(value: unknown, request: Extract<ListValidation, { ok: true }>) {
  if (!Array.isArray(value) || value.length === 0 || value.length > request.limit + 1) return null;
  const messages: Message[] = [];
  let previous = request.cursor;
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || !hasExactFields(item, ROW_FIELDS) ||
        typeof item.status !== 'string' || !LIST_STATUSES.has(item.status)) return null;
    if (item.status !== 'ok') {
      return value.length === 1 && onlyNullData(item) ? { status: item.status, messages: [] } : null;
    }
    if (onlyNullData(item)) return value.length === 1 ? { status: 'ok', messages: [] } : null;
    const message = parseMessageRow(item, request.conversationId);
    if (message === null || seen.has(message.id)) return null;
    seen.add(message.id);
    if (previous !== null) {
      const order = compareDescendingPosition(
        message.createdAt, message.id, previous.createdAt, previous.messageId,
      );
      if (order === null || order <= 0) return null;
    }
    previous = { createdAt: message.createdAt, messageId: message.id };
    messages.push(message);
  }
  return { status: 'ok', messages };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowedResponse();
    const actorId = context.userClaims?.id;
    if (!isUuid(actorId)) return errorResponse(401, 'unauthorized', 'Unauthorized.');

    if (request.method === 'POST') {
      const validation = await validateSend(request);
      if (!validation.ok) return validation.response;
      const { data, error } = await context.supabaseAdmin.rpc('send_direct_message', {
        p_actor_id: actorId, p_conversation_id: validation.conversationId,
        p_message_id: validation.messageId, p_body: validation.body,
      });
      if (error) { console.error('send_direct_message RPC failed.'); return sendFailedResponse(); }
      const result = parseSendResult(data, actorId, validation);
      if (!result) { console.error('send_direct_message RPC returned an invalid result.'); return sendFailedResponse(); }
      if (result.status === 'invalid_request') return invalidResponse();
      if (result.status === 'profile_not_ready') return profileNotReadyResponse();
      if (result.status === 'conversation_not_found') return conversationNotFoundResponse();
      if (result.status === 'message_id_conflict') return conflictResponse();
      return Response.json({ message: result.message }, { status: result.status === 'created' ? 201 : 200 });
    }

    const validation = validateList(request);
    if (!validation.ok) return validation.response;
    const { data, error } = await context.supabaseAdmin.rpc('list_direct_messages', {
      p_actor_id: actorId, p_conversation_id: validation.conversationId,
      p_limit: validation.limit + 1, p_before_created_at: validation.cursor?.createdAt ?? null,
      p_before_message_id: validation.cursor?.messageId ?? null,
    });
    if (error) { console.error('list_direct_messages RPC failed.'); return readFailedResponse(); }
    const result = parseListResult(data, validation);
    if (!result) { console.error('list_direct_messages RPC returned an invalid result.'); return readFailedResponse(); }
    if (result.status === 'invalid_request') return invalidResponse();
    if (result.status === 'profile_not_ready') return profileNotReadyResponse();
    if (result.status === 'conversation_not_found') return conversationNotFoundResponse();
    const hasMore = result.messages.length > validation.limit;
    const messages = hasMore ? result.messages.slice(0, validation.limit) : result.messages;
    const last = hasMore ? messages[messages.length - 1] : null;
    const nextCursor = last ? { createdAt: last.createdAt, messageId: last.id } : null;
    return Response.json({ messages, nextCursor });
  }),
};
