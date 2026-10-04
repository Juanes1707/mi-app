import type {
  DirectConversation, DirectInboxCursor, DirectInboxPage, DirectMessage,
  DirectMessagesCursor, DirectMessagesPage,
} from '@/features/direct-messages/domain/direct-message';

export interface DirectMessagesRepository {
  getOrCreateConversation(expectedOwnerUserId: string, recipientUserId: string): Promise<DirectConversation>;
  getInboxPage(expectedOwnerUserId: string, limit: number, cursor: DirectInboxCursor | null): Promise<DirectInboxPage>;
  getMessagesPage(expectedOwnerUserId: string, conversationId: string, limit: number, cursor: DirectMessagesCursor | null): Promise<DirectMessagesPage>;
  sendMessage(expectedOwnerUserId: string, conversationId: string, messageId: string, body: string): Promise<DirectMessage>;
}
