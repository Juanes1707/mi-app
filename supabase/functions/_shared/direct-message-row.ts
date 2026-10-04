import {
  isNullableTimestamp, isSameUuid, isTimestamp, isUuid, isValidMessageBody, isValidReceiptOrder,
} from './direct-message-values.ts';

// One message row of the DM read model (list_direct_messages / get_direct_message).
// Shared so the history page and the targeted read produce the same DTO.
export type DirectMessageDto = {
  id: string; conversationId: string; senderId: string; body: string; createdAt: string;
  deliveredAt: string | null; readAt: string | null;
};

export const MESSAGE_ROW_FIELDS = new Set([
  'status', 'message_id', 'conversation_id', 'sender_id', 'body', 'created_at', 'delivered_at', 'read_at',
]);

export function onlyNullMessageData(row: Record<string, unknown>): boolean {
  return [...MESSAGE_ROW_FIELDS].every((field) => field === 'status' || row[field] === null);
}

export function parseDirectMessageRow(
  row: Record<string, unknown>,
  expectedConversationId: string,
): DirectMessageDto | null {
  if (!isUuid(row.message_id) || !isSameUuid(row.conversation_id, expectedConversationId) ||
      !isUuid(row.sender_id) || !isValidMessageBody(row.body) || !isTimestamp(row.created_at) ||
      !isNullableTimestamp(row.delivered_at) || !isNullableTimestamp(row.read_at) ||
      !isValidReceiptOrder(row.delivered_at, row.read_at)) return null;
  return {
    id: row.message_id.toLowerCase(), conversationId: row.conversation_id.toLowerCase(),
    senderId: row.sender_id.toLowerCase(), body: row.body, createdAt: row.created_at,
    deliveredAt: row.delivered_at, readAt: row.read_at,
  };
}
