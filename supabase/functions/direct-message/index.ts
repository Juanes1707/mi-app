import { withSupabase } from 'npm:@supabase/server@1';

import {
  MESSAGE_ROW_FIELDS, onlyNullMessageData, parseDirectMessageRow, type DirectMessageDto,
} from '../_shared/direct-message-row.ts';
import { hasExactFields, isRecord, isUuid } from '../_shared/direct-message-values.ts';

// GET /direct-message?conversationId=<uuid>&messageId=<uuid>
// One message through the same read model as GET /direct-messages. It is the
// authorized read behind every Realtime hint: a Broadcast only carries ids, so the
// content is always re-authorized here before it reaches a screen.

type ReadValidation =
  | { ok: true; conversationId: string; messageId: string }
  | { ok: false; response: Response };
type ReadResult =
  | { status: 'ok'; message: DirectMessageDto }
  | { status: 'invalid_request' | 'profile_not_ready' | 'conversation_not_found' | 'message_not_found' };

const QUERY_FIELDS = new Set(['conversationId', 'messageId']);
const STATUSES = new Set(['ok', 'invalid_request', 'profile_not_ready', 'conversation_not_found', 'message_not_found']);

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}
function invalidResponse(): Response {
  return errorResponse(400, 'invalid_direct_message_request', 'A valid direct message request is required.');
}
function readFailedResponse(): Response {
  return errorResponse(500, 'direct_message_read_failed', 'Unable to load message.');
}
function methodNotAllowedResponse(): Response {
  return Response.json({ code: 'method_not_allowed', message: 'Method not allowed.' },
    { status: 405, headers: { Allow: 'GET, OPTIONS' } });
}

function validateRead(request: Request): ReadValidation {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => !QUERY_FIELDS.has(key))) return { ok: false, response: invalidResponse() };
  const conversationIds = params.getAll('conversationId');
  const messageIds = params.getAll('messageId');
  if (conversationIds.length !== 1 || messageIds.length !== 1) return { ok: false, response: invalidResponse() };
  const [conversationId] = conversationIds;
  const [messageId] = messageIds;
  if (!isUuid(conversationId) || !isUuid(messageId)) return { ok: false, response: invalidResponse() };
  return { ok: true, conversationId: conversationId.toLowerCase(), messageId: messageId.toLowerCase() };
}

// The RPC result is untrusted: exactly one row with the read-model columns; a
// non-ok status carries no data; an ok row must be the requested message.
function parseReadResult(value: unknown, request: Extract<ReadValidation, { ok: true }>): ReadResult | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const [row] = value;
  if (!isRecord(row) || !hasExactFields(row, MESSAGE_ROW_FIELDS) ||
      typeof row.status !== 'string' || !STATUSES.has(row.status)) return null;
  if (row.status !== 'ok') {
    if (!onlyNullMessageData(row)) return null;
    return { status: row.status as Exclude<ReadResult['status'], 'ok'> };
  }
  const message = parseDirectMessageRow(row, request.conversationId);
  if (message === null || message.id !== request.messageId) return null;
  return { status: 'ok', message };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'GET') return methodNotAllowedResponse();
    // The actor comes only from the verified JWT.
    const actorId = context.userClaims?.id;
    if (!isUuid(actorId)) return errorResponse(401, 'unauthorized', 'Unauthorized.');

    const validation = validateRead(request);
    if (!validation.ok) return validation.response;

    const { data, error } = await context.supabaseAdmin.rpc('get_direct_message', {
      p_actor_id: actorId, p_conversation_id: validation.conversationId, p_message_id: validation.messageId,
    });
    if (error) { console.error('get_direct_message RPC failed.'); return readFailedResponse(); }
    const result = parseReadResult(data, validation);
    if (!result) { console.error('get_direct_message RPC returned an invalid result.'); return readFailedResponse(); }

    switch (result.status) {
      case 'ok':
        return Response.json({ message: result.message });
      case 'conversation_not_found':
        return errorResponse(404, 'conversation_not_found', 'Conversation not found.');
      case 'message_not_found':
        return errorResponse(404, 'direct_message_not_found', 'Message not found.');
      case 'profile_not_ready':
        return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
      case 'invalid_request':
        return invalidResponse();
      default:
        return readFailedResponse();
    }
  }),
};
