import { withSupabase } from 'npm:@supabase/server@1';

import {
  compareDescendingPosition, hasExactFields, isNullableTimestamp, isRecord,
  isTimestamp, isUuid, isValidMessageBody, isValidReceiptOrder, parseLimit,
} from '../_shared/direct-message-values.ts';

type ConversationCursor = { lastMessageAt: string; conversationId: string };
type GetInboxValidation =
  | { ok: true; limit: number; cursor: ConversationCursor | null }
  | { ok: false; response: Response };
type CreateValidation =
  | { ok: true; recipientUserId: string }
  | { ok: false; response: Response };

const CREATE_FIELDS = new Set(['recipientUserId']);
const CREATE_ROW_FIELDS = new Set([
  'status', 'conversation_id', 'participant_low_id', 'participant_high_id', 'created_at',
]);
const INBOX_QUERY_FIELDS = new Set(['limit', 'beforeLastMessageAt', 'beforeConversationId']);
const INBOX_ROW_FIELDS = new Set([
  'status', 'conversation_id', 'peer_id', 'peer_username', 'peer_display_name',
  'last_message_id', 'last_message_sender_id', 'last_message_body',
  'last_message_created_at', 'last_message_delivered_at', 'last_message_read_at', 'unread_count',
]);
const CREATE_STATUSES = new Set(['ok', 'invalid_request', 'profile_not_ready', 'recipient_not_found']);
const LIST_STATUSES = new Set(['ok', 'invalid_request', 'profile_not_ready']);
const DEFAULT_LIMIT = 30;
const USERNAME_PATTERN = /^[A-Za-z0-9._]{3,30}$/;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}
function invalidResponse(): Response {
  return errorResponse(400, 'invalid_direct_conversation_request', 'A valid direct conversation request is required.');
}
function profileNotReadyResponse(): Response {
  return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
}
function recipientNotFoundResponse(): Response {
  return errorResponse(404, 'recipient_not_found', 'Recipient not found.');
}
function creationFailedResponse(): Response {
  return errorResponse(500, 'direct_conversation_creation_failed', 'Unable to create conversation.');
}
function inboxFailedResponse(): Response {
  return errorResponse(500, 'direct_conversations_read_failed', 'Unable to load conversations.');
}
function methodNotAllowedResponse(): Response {
  return Response.json({ code: 'method_not_allowed', message: 'Method not allowed.' },
    { status: 405, headers: { Allow: 'GET, POST, OPTIONS' } });
}

async function validateCreate(request: Request, actorId: string): Promise<CreateValidation> {
  let body: unknown;
  try { body = await request.json(); } catch { return { ok: false, response: invalidResponse() }; }
  if (!isRecord(body) || !hasExactFields(body, CREATE_FIELDS) ||
      !isUuid(body.recipientUserId) || body.recipientUserId.toLowerCase() === actorId.toLowerCase()) {
    return { ok: false, response: invalidResponse() };
  }
  return { ok: true, recipientUserId: body.recipientUserId.toLowerCase() };
}

function validateInbox(request: Request): GetInboxValidation {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (keys.some((key) => !INBOX_QUERY_FIELDS.has(key)) ||
      [...INBOX_QUERY_FIELDS].some((key) => params.getAll(key).length > 1)) {
    return { ok: false, response: invalidResponse() };
  }
  const limit = parseLimit(params.get('limit') ?? undefined, DEFAULT_LIMIT);
  if (limit === null) return { ok: false, response: invalidResponse() };
  const times = params.getAll('beforeLastMessageAt');
  const ids = params.getAll('beforeConversationId');
  if (times.length === 0 && ids.length === 0) return { ok: true, limit, cursor: null };
  if (times.length !== 1 || ids.length !== 1 || !isTimestamp(times[0]) || !isUuid(ids[0])) {
    return { ok: false, response: invalidResponse() };
  }
  return { ok: true, limit, cursor: { lastMessageAt: times[0], conversationId: ids[0].toLowerCase() } };
}

function onlyNullCreateData(row: Record<string, unknown>): boolean {
  return row.conversation_id === null && row.participant_low_id === null &&
    row.participant_high_id === null && row.created_at === null;
}
function onlyNullInboxData(row: Record<string, unknown>): boolean {
  return [...INBOX_ROW_FIELDS].every((field) => field === 'status' || row[field] === null);
}

function parseCreateResult(value: unknown, actorId: string, recipientId: string) {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0]) ||
      !hasExactFields(value[0], CREATE_ROW_FIELDS)) return null;
  const row = value[0];
  if (typeof row.status !== 'string' || !CREATE_STATUSES.has(row.status)) return null;
  if (row.status !== 'ok') return onlyNullCreateData(row) ? { status: row.status } : null;
  if (!isUuid(row.conversation_id) || !isUuid(row.participant_low_id) ||
      !isUuid(row.participant_high_id) || !isTimestamp(row.created_at)) return null;
  const low = row.participant_low_id.toLowerCase();
  const high = row.participant_high_id.toLowerCase();
  const participants = [low, high];
  if (low >= high || !participants.includes(actorId.toLowerCase()) ||
      !participants.includes(recipientId.toLowerCase())) return null;
  return {
    status: 'ok',
    conversation: { id: row.conversation_id.toLowerCase(), peerUserId: recipientId, createdAt: row.created_at },
  };
}

function parseInboxResult(value: unknown, request: Extract<GetInboxValidation, { ok: true }>, actorId: string) {
  if (!Array.isArray(value) || value.length === 0 || value.length > request.limit + 1) return null;
  const conversations: Array<{
    id: string; peer: { id: string; username: string | null; displayName: string | null };
    lastMessage: { id: string; senderId: string; body: string; createdAt: string; deliveredAt: string | null; readAt: string | null };
    unreadCount: number;
  }> = [];
  let previous = request.cursor;
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || !hasExactFields(item, INBOX_ROW_FIELDS) ||
        typeof item.status !== 'string' || !LIST_STATUSES.has(item.status)) return null;
    if (item.status !== 'ok') {
      return value.length === 1 && onlyNullInboxData(item) ? { status: item.status, conversations: [] } : null;
    }
    if (onlyNullInboxData(item)) {
      return value.length === 1 ? { status: 'ok', conversations: [] } : null;
    }
    if (!isUuid(item.conversation_id) || !isUuid(item.peer_id) ||
        (item.peer_username !== null &&
          (typeof item.peer_username !== 'string' || !USERNAME_PATTERN.test(item.peer_username))) ||
        (item.peer_display_name !== null && typeof item.peer_display_name !== 'string') ||
        !isUuid(item.last_message_id) || !isUuid(item.last_message_sender_id) ||
        !isValidMessageBody(item.last_message_body) || !isTimestamp(item.last_message_created_at) ||
        !isNullableTimestamp(item.last_message_delivered_at) || !isNullableTimestamp(item.last_message_read_at) ||
        !isValidReceiptOrder(item.last_message_delivered_at, item.last_message_read_at) ||
        !Number.isSafeInteger(item.unread_count) || Number(item.unread_count) < 0 ||
        item.peer_id.toLowerCase() === actorId.toLowerCase() ||
        ![actorId.toLowerCase(), item.peer_id.toLowerCase()].includes(
          item.last_message_sender_id.toLowerCase(),
        )) return null;
    const id = item.conversation_id.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    if (previous !== null) {
      const order = compareDescendingPosition(
        item.last_message_created_at, id, previous.lastMessageAt, previous.conversationId,
      );
      if (order === null || order <= 0) return null;
    }
    previous = { lastMessageAt: item.last_message_created_at, conversationId: id };
    conversations.push({
      id,
      peer: { id: item.peer_id.toLowerCase(), username: item.peer_username, displayName: item.peer_display_name },
      lastMessage: {
        id: item.last_message_id.toLowerCase(), senderId: item.last_message_sender_id.toLowerCase(),
        body: item.last_message_body, createdAt: item.last_message_created_at,
        deliveredAt: item.last_message_delivered_at, readAt: item.last_message_read_at,
      },
      unreadCount: item.unread_count as number,
    });
  }
  return { status: 'ok', conversations };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowedResponse();
    const actorId = context.userClaims?.id;
    if (!isUuid(actorId)) return errorResponse(401, 'unauthorized', 'Unauthorized.');

    if (request.method === 'POST') {
      const validation = await validateCreate(request, actorId);
      if (!validation.ok) return validation.response;
      const { data, error } = await context.supabaseAdmin.rpc('get_or_create_direct_conversation', {
        p_actor_id: actorId, p_recipient_id: validation.recipientUserId,
      });
      if (error) { console.error('get_or_create_direct_conversation RPC failed.'); return creationFailedResponse(); }
      const result = parseCreateResult(data, actorId, validation.recipientUserId);
      if (!result) { console.error('get_or_create_direct_conversation RPC returned an invalid result.'); return creationFailedResponse(); }
      if (result.status === 'invalid_request') return invalidResponse();
      if (result.status === 'profile_not_ready') return profileNotReadyResponse();
      if (result.status === 'recipient_not_found') return recipientNotFoundResponse();
      return Response.json({ conversation: result.conversation });
    }

    const validation = validateInbox(request);
    if (!validation.ok) return validation.response;
    const { data, error } = await context.supabaseAdmin.rpc('list_direct_conversations', {
      p_actor_id: actorId, p_limit: validation.limit + 1,
      p_before_last_message_at: validation.cursor?.lastMessageAt ?? null,
      p_before_conversation_id: validation.cursor?.conversationId ?? null,
    });
    if (error) { console.error('list_direct_conversations RPC failed.'); return inboxFailedResponse(); }
    const result = parseInboxResult(data, validation, actorId);
    if (!result) { console.error('list_direct_conversations RPC returned an invalid result.'); return inboxFailedResponse(); }
    if (result.status === 'invalid_request') return invalidResponse();
    if (result.status === 'profile_not_ready') return profileNotReadyResponse();
    const hasMore = result.conversations.length > validation.limit;
    const conversations = hasMore ? result.conversations.slice(0, validation.limit) : result.conversations;
    const last = hasMore ? conversations[conversations.length - 1] : null;
    const nextCursor = last ? { lastMessageAt: last.lastMessage.createdAt, conversationId: last.id } : null;
    return Response.json({ conversations, nextCursor });
  }),
};
