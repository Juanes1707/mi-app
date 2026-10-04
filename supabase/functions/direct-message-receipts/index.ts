import { withSupabase } from 'npm:@supabase/server@1';

import { hasExactFields, isRecord, isSameUuid, isTimestamp, isUuid } from '../_shared/direct-message-values.ts';

// POST /direct-message-receipts { conversationId, throughMessageId, kind }
// Marks the PEER's messages up to throughMessageId as delivered or read for the
// actor of the verified JWT. One RPC; the transition and its Broadcast are atomic
// and idempotent in PostgreSQL.

type ReceiptKind = 'delivered' | 'read';
type Receipt = {
  conversationId: string; messageSenderId: string; throughMessageId: string;
  throughCreatedAt: string; kind: ReceiptKind; at: string | null; updatedCount: number;
};
type MarkValidation =
  | { ok: true; conversationId: string; throughMessageId: string; kind: ReceiptKind }
  | { ok: false; response: Response };
type MarkResult =
  | { status: 'ok'; receipt: Receipt }
  | { status: 'invalid_request' | 'profile_not_ready' | 'conversation_not_found' | 'message_not_found' };

const BODY_FIELDS = new Set(['conversationId', 'throughMessageId', 'kind']);
const KINDS = new Set(['delivered', 'read']);
const ROW_FIELDS = new Set([
  'status', 'conversation_id', 'message_sender_id', 'through_message_id', 'through_created_at',
  'kind', 'receipt_at', 'updated_count',
]);
const STATUSES = new Set(['ok', 'invalid_request', 'profile_not_ready', 'conversation_not_found', 'message_not_found']);

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}
function invalidResponse(): Response {
  return errorResponse(400, 'invalid_direct_message_receipt_request', 'A valid direct message receipt request is required.');
}
function failedResponse(): Response {
  return errorResponse(500, 'direct_message_receipt_failed', 'Unable to update message receipts.');
}
function methodNotAllowedResponse(): Response {
  return Response.json({ code: 'method_not_allowed', message: 'Method not allowed.' },
    { status: 405, headers: { Allow: 'POST, OPTIONS' } });
}

async function validateMark(request: Request): Promise<MarkValidation> {
  let body: unknown;
  try { body = await request.json(); } catch { return { ok: false, response: invalidResponse() }; }
  if (!isRecord(body) || !hasExactFields(body, BODY_FIELDS) || !isUuid(body.conversationId) ||
      !isUuid(body.throughMessageId) || typeof body.kind !== 'string' || !KINDS.has(body.kind)) {
    return { ok: false, response: invalidResponse() };
  }
  return {
    ok: true, conversationId: body.conversationId.toLowerCase(),
    throughMessageId: body.throughMessageId.toLowerCase(), kind: body.kind as ReceiptKind,
  };
}

function onlyNullData(row: Record<string, unknown>): boolean {
  return [...ROW_FIELDS].every((field) => field === 'status' || row[field] === null);
}

// The RPC result is untrusted: one row, exact columns; an ok row must echo the
// request, name a sender other than the actor, and report a timestamp exactly when
// something changed.
function parseMarkResult(
  value: unknown,
  actorId: string,
  request: Extract<MarkValidation, { ok: true }>,
): MarkResult | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const [row] = value;
  if (!isRecord(row) || !hasExactFields(row, ROW_FIELDS) ||
      typeof row.status !== 'string' || !STATUSES.has(row.status)) return null;
  if (row.status !== 'ok') {
    if (!onlyNullData(row)) return null;
    return { status: row.status as Exclude<MarkResult['status'], 'ok'> };
  }
  const updatedCount = row.updated_count;
  if (!isSameUuid(row.conversation_id, request.conversationId) ||
      !isSameUuid(row.through_message_id, request.throughMessageId) ||
      !isUuid(row.message_sender_id) || row.message_sender_id.toLowerCase() === actorId.toLowerCase() ||
      !isTimestamp(row.through_created_at) || row.kind !== request.kind ||
      typeof updatedCount !== 'number' || !Number.isSafeInteger(updatedCount) || updatedCount < 0 ||
      (updatedCount === 0 ? row.receipt_at !== null : !isTimestamp(row.receipt_at))) return null;
  return {
    status: 'ok',
    receipt: {
      conversationId: request.conversationId, messageSenderId: row.message_sender_id.toLowerCase(),
      throughMessageId: request.throughMessageId, throughCreatedAt: row.through_created_at,
      kind: request.kind, at: updatedCount === 0 ? null : row.receipt_at as string, updatedCount,
    },
  };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'POST') return methodNotAllowedResponse();
    // The actor comes only from the verified JWT.
    const actorId = context.userClaims?.id;
    if (!isUuid(actorId)) return errorResponse(401, 'unauthorized', 'Unauthorized.');

    const validation = await validateMark(request);
    if (!validation.ok) return validation.response;

    const { data, error } = await context.supabaseAdmin.rpc('mark_direct_message_receipt', {
      p_actor_id: actorId, p_conversation_id: validation.conversationId,
      p_through_message_id: validation.throughMessageId, p_kind: validation.kind,
    });
    if (error) { console.error('mark_direct_message_receipt RPC failed.'); return failedResponse(); }
    const result = parseMarkResult(data, actorId, validation);
    if (!result) { console.error('mark_direct_message_receipt RPC returned an invalid result.'); return failedResponse(); }

    switch (result.status) {
      case 'ok':
        return Response.json({ receipt: result.receipt });
      case 'conversation_not_found':
        return errorResponse(404, 'conversation_not_found', 'Conversation not found.');
      case 'message_not_found':
        return errorResponse(404, 'direct_message_not_found', 'Message not found.');
      case 'profile_not_ready':
        return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
      case 'invalid_request':
        return invalidResponse();
      default:
        return failedResponse();
    }
  }),
};
