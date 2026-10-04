import {
  parseDirectConversation, parseDirectInboxPage, parseDirectMessageReceipt, parseDirectMessageResponse,
  parseDirectMessagesPage, parseSentDirectMessage,
} from '@/features/direct-messages/data/direct-messages-response';
import type {
  DirectConversation, DirectInboxCursor, DirectInboxPage, DirectMessage, DirectMessageReceipt,
  DirectMessageReceiptKind, DirectMessagesCursor, DirectMessagesPage,
} from '@/features/direct-messages/domain/direct-message';
import { DirectMessagesError } from '@/features/direct-messages/domain/direct-messages-error';
import type { DirectMessagesRepository } from '@/features/direct-messages/domain/direct-messages-repository';
import {
  AuthenticatedBackendApiClient, AuthenticatedUserMismatchError, AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

type Endpoint = 'conversation' | 'inbox' | 'messages' | 'message' | 'send' | 'receipt';

export class BackendDirectMessagesRepository implements DirectMessagesRepository {
  constructor(private readonly client: AuthenticatedBackendApiClient) {}

  async getOrCreateConversation(owner: string, recipient: string): Promise<DirectConversation> {
    let response: unknown;
    try {
      response = await this.client.postAsUser<unknown, { recipientUserId: string }>(
        owner, '/direct-conversations', { recipientUserId: recipient },
      );
    } catch (error: unknown) { throw mapError(error, 'conversation'); }
    const conversation = parseDirectConversation(response, recipient);
    if (conversation === null) throw new DirectMessagesError('invalid-response');
    return conversation;
  }

  async getInboxPage(owner: string, limit: number, cursor: DirectInboxCursor | null): Promise<DirectInboxPage> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) {
      params.set('beforeLastMessageAt', cursor.lastMessageAt);
      params.set('beforeConversationId', cursor.conversationId);
    }
    let response: unknown;
    try { response = await this.client.getAsUser<unknown>(owner, `/direct-conversations?${params}`); }
    catch (error: unknown) { throw mapError(error, 'inbox'); }
    const page = parseDirectInboxPage(response, { ownerUserId: owner, limit, cursor });
    if (page === null) throw new DirectMessagesError('invalid-response');
    return page;
  }

  async getMessagesPage(owner: string, conversationId: string, limit: number, cursor: DirectMessagesCursor | null): Promise<DirectMessagesPage> {
    const params = new URLSearchParams({ conversationId, limit: String(limit) });
    if (cursor) {
      params.set('beforeCreatedAt', cursor.createdAt);
      params.set('beforeMessageId', cursor.messageId);
    }
    let response: unknown;
    try { response = await this.client.getAsUser<unknown>(owner, `/direct-messages?${params}`); }
    catch (error: unknown) { throw mapError(error, 'messages'); }
    const page = parseDirectMessagesPage(response, { conversationId, limit, cursor });
    if (page === null) throw new DirectMessagesError('invalid-response');
    return page;
  }

  // The authorized read behind a Realtime hint: the hint never carries content.
  async getMessage(owner: string, conversationId: string, messageId: string): Promise<DirectMessage> {
    const params = new URLSearchParams({ conversationId, messageId });
    let response: unknown;
    try { response = await this.client.getAsUser<unknown>(owner, `/direct-message?${params}`); }
    catch (error: unknown) { throw mapError(error, 'message'); }
    const message = parseDirectMessageResponse(response, { conversationId, messageId });
    if (message === null) throw new DirectMessagesError('invalid-response');
    return message;
  }

  async sendMessage(owner: string, conversationId: string, messageId: string, body: string): Promise<DirectMessage> {
    let response: unknown;
    try {
      response = await this.client.postAsUser<unknown, {
        conversationId: string; messageId: string; body: string;
      }>(owner, '/direct-messages', { conversationId, messageId, body });
    } catch (error: unknown) { throw mapError(error, 'send'); }
    const message = parseSentDirectMessage(response, {
      conversationId, messageId, senderId: owner, body,
    });
    if (message === null) throw new DirectMessagesError('invalid-response');
    return message;
  }

  async markReceipt(
    owner: string, conversationId: string, throughMessageId: string, kind: DirectMessageReceiptKind,
  ): Promise<DirectMessageReceipt> {
    let response: unknown;
    try {
      response = await this.client.postAsUser<unknown, {
        conversationId: string; throughMessageId: string; kind: DirectMessageReceiptKind;
      }>(owner, '/direct-message-receipts', { conversationId, throughMessageId, kind });
    } catch (error: unknown) { throw mapError(error, 'receipt'); }
    const receipt = parseDirectMessageReceipt(response, { ownerUserId: owner, conversationId, throughMessageId, kind });
    if (receipt === null) throw new DirectMessagesError('invalid-response');
    return receipt;
  }
}

function mapError(error: unknown, endpoint: Endpoint): DirectMessagesError {
  if (error instanceof AuthenticatedUserMismatchError) return new DirectMessagesError('owner-session-mismatch');
  if (error instanceof AuthenticationRequiredError) return new DirectMessagesError('authentication-required');
  if (!(error instanceof BackendApiError)) return new DirectMessagesError('unavailable');
  if (error.code === 'invalid-json') return new DirectMessagesError('invalid-response');
  if (error.code !== 'http') return new DirectMessagesError('unavailable');
  if (error.status === 401) return new DirectMessagesError('authentication-required');
  if (error.status === 400 && (
    error.backendCode === 'invalid_direct_conversation_request' ||
    error.backendCode === 'invalid_direct_message_request' ||
    error.backendCode === 'invalid_direct_message_receipt_request'
  )) return new DirectMessagesError('invalid-request');
  if (endpoint === 'conversation' && error.status === 404 && error.backendCode === 'recipient_not_found') {
    return new DirectMessagesError('recipient-not-found');
  }
  if ((endpoint === 'messages' || endpoint === 'message' || endpoint === 'send' || endpoint === 'receipt') &&
      error.status === 404 && error.backendCode === 'conversation_not_found') {
    return new DirectMessagesError('conversation-not-found');
  }
  if ((endpoint === 'message' || endpoint === 'receipt') && error.status === 404 &&
      error.backendCode === 'direct_message_not_found') return new DirectMessagesError('message-not-found');
  if (error.status === 409 && error.backendCode === 'profile_not_ready') {
    return new DirectMessagesError('profile-not-ready');
  }
  if (endpoint === 'send' && error.status === 409 && error.backendCode === 'message_creation_conflict') {
    return new DirectMessagesError('message-conflict');
  }
  return new DirectMessagesError('unavailable');
}
