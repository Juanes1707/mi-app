import type {
  DirectConversation, DirectInboxCursor, DirectInboxPage, DirectMessage, DirectMessageReceipt,
  DirectMessageReceiptKind, DirectMessagesCursor, DirectMessagesPage,
} from '@/features/direct-messages/domain/direct-message';
import { DirectMessagesError } from '@/features/direct-messages/domain/direct-messages-error';
import type { DirectMessagesRepository } from '@/features/direct-messages/domain/direct-messages-repository';
import { isDirectTimestamp, isValidDirectMessageBody, normalizeDirectUuid } from '@/features/direct-messages/domain/direct-message-values';
import type { UuidGenerator } from '@/shared/application/uuid-generator';

export const DIRECT_MESSAGES_PAGE_SIZE = 30;

export class GetOrCreateDirectConversation {
  constructor(private readonly repository: DirectMessagesRepository) {}
  execute(ownerUserId: string, recipientUserId: string): Promise<DirectConversation> {
    const owner = normalizeDirectUuid(ownerUserId);
    const recipient = normalizeDirectUuid(recipientUserId);
    if (owner === null || recipient === null || owner === recipient) throw new DirectMessagesError('invalid-request');
    return this.repository.getOrCreateConversation(owner, recipient);
  }
}
export class GetDirectInboxPage {
  constructor(private readonly repository: DirectMessagesRepository) {}
  execute(ownerUserId: string, cursor: DirectInboxCursor | null, limit = DIRECT_MESSAGES_PAGE_SIZE): Promise<DirectInboxPage> {
    const owner = normalizeDirectUuid(ownerUserId);
    if (owner === null || !validLimit(limit) || (cursor !== null &&
      (!isDirectTimestamp(cursor.lastMessageAt) || normalizeDirectUuid(cursor.conversationId) === null))) {
      throw new DirectMessagesError('invalid-request');
    }
    return this.repository.getInboxPage(owner, limit, cursor);
  }
}
export class GetDirectMessagesPage {
  constructor(private readonly repository: DirectMessagesRepository) {}
  execute(ownerUserId: string, conversationId: string, cursor: DirectMessagesCursor | null, limit = DIRECT_MESSAGES_PAGE_SIZE): Promise<DirectMessagesPage> {
    const owner = normalizeDirectUuid(ownerUserId);
    const conversation = normalizeDirectUuid(conversationId);
    if (owner === null || conversation === null || !validLimit(limit) || (cursor !== null &&
      (!isDirectTimestamp(cursor.createdAt) || normalizeDirectUuid(cursor.messageId) === null))) {
      throw new DirectMessagesError('invalid-request');
    }
    return this.repository.getMessagesPage(owner, conversation, limit, cursor);
  }
}
export class CreateDirectMessageId {
  constructor(private readonly ids: UuidGenerator) {}
  execute(): string {
    const id = normalizeDirectUuid(this.ids.generate());
    if (id === null) throw new DirectMessagesError('unavailable');
    return id;
  }
}
export class SendDirectMessage {
  constructor(private readonly repository: DirectMessagesRepository) {}
  execute(ownerUserId: string, conversationId: string, messageId: string, body: string): Promise<DirectMessage> {
    const owner = normalizeDirectUuid(ownerUserId);
    const conversation = normalizeDirectUuid(conversationId);
    const message = normalizeDirectUuid(messageId);
    if (owner === null || conversation === null || message === null || !isValidDirectMessageBody(body)) {
      throw new DirectMessagesError('invalid-request');
    }
    return this.repository.sendMessage(owner, conversation, message, body);
  }
}
// The canonical message behind a Realtime hint, through the owner-bound HTTP read.
export class GetDirectMessage {
  constructor(private readonly repository: DirectMessagesRepository) {}
  execute(ownerUserId: string, conversationId: string, messageId: string): Promise<DirectMessage> {
    const owner = normalizeDirectUuid(ownerUserId);
    const conversation = normalizeDirectUuid(conversationId);
    const message = normalizeDirectUuid(messageId);
    if (owner === null || conversation === null || message === null) throw new DirectMessagesError('invalid-request');
    return this.repository.getMessage(owner, conversation, message);
  }
}
export class MarkDirectMessageReceipt {
  constructor(private readonly repository: DirectMessagesRepository) {}
  execute(
    ownerUserId: string, conversationId: string, throughMessageId: string, kind: DirectMessageReceiptKind,
  ): Promise<DirectMessageReceipt> {
    const owner = normalizeDirectUuid(ownerUserId);
    const conversation = normalizeDirectUuid(conversationId);
    const through = normalizeDirectUuid(throughMessageId);
    if (owner === null || conversation === null || through === null || (kind !== 'delivered' && kind !== 'read')) {
      throw new DirectMessagesError('invalid-request');
    }
    return this.repository.markReceipt(owner, conversation, through, kind);
  }
}
function validLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 50;
}
