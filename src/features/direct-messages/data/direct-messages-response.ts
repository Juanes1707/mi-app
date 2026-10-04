import type {
  DirectConversation, DirectConversationSummary, DirectInboxCursor, DirectInboxPage,
  DirectMessage, DirectMessageReceipt, DirectMessageReceiptKind, DirectMessagesCursor, DirectMessagesPage,
} from '@/features/direct-messages/domain/direct-message';
import {
  compareDirectPositions, isDirectTimestamp, isValidDirectMessageBody,
  isValidReceiptOrder, normalizeDirectUuid,
} from '@/features/direct-messages/domain/direct-message-values';

const CONVERSATION_RESPONSE_FIELDS = ['conversation'];
const CONVERSATION_FIELDS = ['id', 'peerUserId', 'createdAt'];
const INBOX_RESPONSE_FIELDS = ['conversations', 'nextCursor'];
const SUMMARY_FIELDS = ['id', 'peer', 'lastMessage', 'unreadCount'];
const PEER_FIELDS = ['id', 'username', 'displayName'];
const INBOX_MESSAGE_FIELDS = ['id', 'senderId', 'body', 'createdAt', 'deliveredAt', 'readAt'];
const MESSAGE_RESPONSE_FIELDS = ['messages', 'nextCursor'];
const MESSAGE_FIELDS = ['id', 'conversationId', 'senderId', 'body', 'createdAt', 'deliveredAt', 'readAt'];
const INBOX_CURSOR_FIELDS = ['lastMessageAt', 'conversationId'];
const MESSAGE_CURSOR_FIELDS = ['createdAt', 'messageId'];
const RECEIPT_FIELDS = ['conversationId', 'messageSenderId', 'throughMessageId', 'throughCreatedAt', 'kind', 'at', 'updatedCount'];
const USERNAME_PATTERN = /^[A-Za-z0-9._]{3,30}$/;

export function parseDirectConversation(value: unknown, recipientUserId: string): DirectConversation | null {
  if (!hasExactFields(value, CONVERSATION_RESPONSE_FIELDS) ||
      !hasExactFields(value.conversation, CONVERSATION_FIELDS)) return null;
  const id = normalizeDirectUuid(value.conversation.id);
  const peerUserId = normalizeDirectUuid(value.conversation.peerUserId);
  if (id === null || peerUserId !== recipientUserId || !isDirectTimestamp(value.conversation.createdAt)) return null;
  return { id, peerUserId, createdAt: value.conversation.createdAt };
}

export function parseDirectInboxPage(
  value: unknown,
  expected: { ownerUserId: string; limit: number; cursor: DirectInboxCursor | null },
): DirectInboxPage | null {
  if (!hasExactFields(value, INBOX_RESPONSE_FIELDS) || !Array.isArray(value.conversations) ||
      value.conversations.length > expected.limit) return null;
  const conversations: DirectConversationSummary[] = [];
  const seen = new Set<string>();
  let previous = expected.cursor === null ? null : {
    createdAt: expected.cursor.lastMessageAt, id: expected.cursor.conversationId,
  };
  for (const item of value.conversations as unknown[]) {
    const summary = parseSummary(item, expected.ownerUserId);
    if (summary === null || seen.has(summary.id)) return null;
    seen.add(summary.id);
    if (previous !== null) {
      const order = compareDirectPositions(
        { createdAt: summary.lastMessage.createdAt, id: summary.id }, previous,
      );
      if (order === null || order <= 0) return null;
    }
    previous = { createdAt: summary.lastMessage.createdAt, id: summary.id };
    conversations.push(summary);
  }
  const nextCursor = parseInboxCursor(value.nextCursor);
  if (nextCursor === undefined) return null;
  const last = conversations[conversations.length - 1];
  if (nextCursor !== null && (conversations.length !== expected.limit || last === undefined ||
      nextCursor.lastMessageAt !== last.lastMessage.createdAt || nextCursor.conversationId !== last.id)) return null;
  return { conversations, nextCursor };
}

export function parseDirectMessagesPage(
  value: unknown,
  expected: { conversationId: string; limit: number; cursor: DirectMessagesCursor | null },
): DirectMessagesPage | null {
  if (!hasExactFields(value, MESSAGE_RESPONSE_FIELDS) || !Array.isArray(value.messages) ||
      value.messages.length > expected.limit) return null;
  const messages: DirectMessage[] = [];
  const seen = new Set<string>();
  let previous = expected.cursor === null ? null : { createdAt: expected.cursor.createdAt, id: expected.cursor.messageId };
  for (const item of value.messages as unknown[]) {
    const message = parseMessage(item, expected.conversationId);
    if (message === null || seen.has(message.id)) return null;
    seen.add(message.id);
    if (previous !== null) {
      const order = compareDirectPositions(message, previous);
      if (order === null || order <= 0) return null;
    }
    previous = message;
    messages.push(message);
  }
  const nextCursor = parseMessageCursor(value.nextCursor);
  if (nextCursor === undefined) return null;
  const last = messages[messages.length - 1];
  if (nextCursor !== null && (messages.length !== expected.limit || last === undefined ||
      nextCursor.createdAt !== last.createdAt || nextCursor.messageId !== last.id)) return null;
  return { messages, nextCursor };
}

export function parseSentDirectMessage(value: unknown, expected: {
  conversationId: string; messageId: string; senderId: string; body: string;
}): DirectMessage | null {
  if (!hasExactFields(value, ['message'])) return null;
  const message = parseMessage(value.message, expected.conversationId);
  return message !== null && message.id === expected.messageId &&
    message.senderId === expected.senderId && message.body === expected.body ? message : null;
}

// GET /direct-message: the same message parser as the history page, and it must be
// exactly the message that was asked for.
export function parseDirectMessageResponse(value: unknown, expected: {
  conversationId: string; messageId: string;
}): DirectMessage | null {
  if (!hasExactFields(value, ['message'])) return null;
  const message = parseMessage(value.message, expected.conversationId);
  return message !== null && message.id === expected.messageId ? message : null;
}

// POST /direct-message-receipts: echoes the request; the marked messages belong to
// the peer (never the owner); a timestamp exactly when something changed.
export function parseDirectMessageReceipt(value: unknown, expected: {
  ownerUserId: string; conversationId: string; throughMessageId: string; kind: DirectMessageReceiptKind;
}): DirectMessageReceipt | null {
  if (!hasExactFields(value, ['receipt']) || !hasExactFields(value.receipt, RECEIPT_FIELDS)) return null;
  const receipt = value.receipt;
  const conversationId = normalizeDirectUuid(receipt.conversationId);
  const messageSenderId = normalizeDirectUuid(receipt.messageSenderId);
  const throughMessageId = normalizeDirectUuid(receipt.throughMessageId);
  const { at, updatedCount, throughCreatedAt } = receipt;
  if (conversationId !== expected.conversationId || throughMessageId !== expected.throughMessageId ||
      messageSenderId === null || messageSenderId === expected.ownerUserId || receipt.kind !== expected.kind ||
      !isDirectTimestamp(throughCreatedAt) || typeof updatedCount !== 'number' ||
      !Number.isSafeInteger(updatedCount) || updatedCount < 0) return null;
  if (updatedCount === 0 ? at !== null : !isDirectTimestamp(at)) return null;
  return {
    conversationId, messageSenderId, throughMessageId, throughCreatedAt, kind: expected.kind,
    at: updatedCount === 0 ? null : at as string, updatedCount,
  };
}

function parseSummary(value: unknown, ownerUserId: string): DirectConversationSummary | null {
  if (!hasExactFields(value, SUMMARY_FIELDS) || !hasExactFields(value.peer, PEER_FIELDS) ||
      !hasExactFields(value.lastMessage, INBOX_MESSAGE_FIELDS)) return null;
  const id = normalizeDirectUuid(value.id);
  const peerId = normalizeDirectUuid(value.peer.id);
  const messageId = normalizeDirectUuid(value.lastMessage.id);
  const senderId = normalizeDirectUuid(value.lastMessage.senderId);
  if (id === null || peerId === null || messageId === null || senderId === null ||
      !nullableUsername(value.peer.username) || !nullableString(value.peer.displayName) ||
      !isValidDirectMessageBody(value.lastMessage.body) || !isDirectTimestamp(value.lastMessage.createdAt) ||
      !nullableTimestamp(value.lastMessage.deliveredAt) || !nullableTimestamp(value.lastMessage.readAt) ||
      !isValidReceiptOrder(value.lastMessage.deliveredAt, value.lastMessage.readAt) ||
      !Number.isSafeInteger(value.unreadCount) || Number(value.unreadCount) < 0 ||
      peerId === ownerUserId || ![ownerUserId, peerId].includes(senderId)) return null;
  return {
    id, peer: { id: peerId, username: value.peer.username, displayName: value.peer.displayName },
    lastMessage: {
      id: messageId, conversationId: id, senderId, body: value.lastMessage.body,
      createdAt: value.lastMessage.createdAt, deliveredAt: value.lastMessage.deliveredAt,
      readAt: value.lastMessage.readAt,
    },
    unreadCount: value.unreadCount as number,
  };
}

function parseMessage(value: unknown, expectedConversationId: string): DirectMessage | null {
  if (!hasExactFields(value, MESSAGE_FIELDS)) return null;
  const id = normalizeDirectUuid(value.id);
  const conversationId = normalizeDirectUuid(value.conversationId);
  const senderId = normalizeDirectUuid(value.senderId);
  if (id === null || conversationId !== expectedConversationId || senderId === null ||
      !isValidDirectMessageBody(value.body) || !isDirectTimestamp(value.createdAt) ||
      !nullableTimestamp(value.deliveredAt) || !nullableTimestamp(value.readAt) ||
      !isValidReceiptOrder(value.deliveredAt, value.readAt)) return null;
  return { id, conversationId, senderId, body: value.body, createdAt: value.createdAt,
    deliveredAt: value.deliveredAt, readAt: value.readAt };
}

function parseInboxCursor(value: unknown): DirectInboxCursor | null | undefined {
  if (value === null) return null;
  if (!hasExactFields(value, INBOX_CURSOR_FIELDS) || !isDirectTimestamp(value.lastMessageAt)) return undefined;
  const conversationId = normalizeDirectUuid(value.conversationId);
  return conversationId === null ? undefined : { lastMessageAt: value.lastMessageAt, conversationId };
}
function parseMessageCursor(value: unknown): DirectMessagesCursor | null | undefined {
  if (value === null) return null;
  if (!hasExactFields(value, MESSAGE_CURSOR_FIELDS) || !isDirectTimestamp(value.createdAt)) return undefined;
  const messageId = normalizeDirectUuid(value.messageId);
  return messageId === null ? undefined : { createdAt: value.createdAt, messageId };
}
function hasExactFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}
function nullableString(value: unknown): value is string | null { return value === null || typeof value === 'string'; }
function nullableUsername(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && USERNAME_PATTERN.test(value));
}
function nullableTimestamp(value: unknown): value is string | null {
  return value === null || isDirectTimestamp(value);
}
