export type DirectMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
  deliveredAt: string | null;
  readAt: string | null;
};

export type DirectConversation = { id: string; peerUserId: string; createdAt: string };
export type DirectConversationSummary = {
  id: string;
  peer: { id: string; username: string | null; displayName: string | null };
  lastMessage: DirectMessage;
  unreadCount: number;
};
export type DirectInboxCursor = { lastMessageAt: string; conversationId: string };
export type DirectMessagesCursor = { createdAt: string; messageId: string };
export type DirectInboxPage = {
  conversations: DirectConversationSummary[];
  nextCursor: DirectInboxCursor | null;
};
export type DirectMessagesPage = {
  messages: DirectMessage[];
  nextCursor: DirectMessagesCursor | null;
};

export type DirectMessageReceiptKind = 'delivered' | 'read';
// The server's answer to a delivered/read mark over the PEER's messages up to
// throughMessageId (a high-watermark). `at` is null when nothing changed.
export type DirectMessageReceipt = {
  conversationId: string;
  messageSenderId: string;
  throughMessageId: string;
  throughCreatedAt: string;
  kind: DirectMessageReceiptKind;
  at: string | null;
  updatedCount: number;
};
