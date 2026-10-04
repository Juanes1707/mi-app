import type {
  DirectConversation, DirectInboxCursor, DirectInboxPage, DirectMessage, DirectMessageReceipt,
  DirectMessageReceiptKind, DirectMessagesCursor, DirectMessagesPage,
} from '@/features/direct-messages/domain/direct-message';

export interface DirectMessagesRepository {
  getOrCreateConversation(expectedOwnerUserId: string, recipientUserId: string): Promise<DirectConversation>;
  getInboxPage(expectedOwnerUserId: string, limit: number, cursor: DirectInboxCursor | null): Promise<DirectInboxPage>;
  getMessagesPage(expectedOwnerUserId: string, conversationId: string, limit: number, cursor: DirectMessagesCursor | null): Promise<DirectMessagesPage>;
  getMessage(expectedOwnerUserId: string, conversationId: string, messageId: string): Promise<DirectMessage>;
  sendMessage(expectedOwnerUserId: string, conversationId: string, messageId: string, body: string): Promise<DirectMessage>;
  markReceipt(expectedOwnerUserId: string, conversationId: string, throughMessageId: string, kind: DirectMessageReceiptKind): Promise<DirectMessageReceipt>;
}
