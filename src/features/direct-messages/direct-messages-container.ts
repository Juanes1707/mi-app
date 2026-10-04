import {
  CreateDirectMessageId, GetDirectInboxPage, GetDirectMessagesPage,
  GetOrCreateDirectConversation, SendDirectMessage,
} from '@/features/direct-messages/application/direct-message-use-cases';
import { BackendDirectMessagesRepository } from '@/features/direct-messages/data/backend-direct-messages-repository';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';
import { expoUuidGenerator } from '@/shared/infrastructure/expo-uuid-generator';

const repository = new BackendDirectMessagesRepository(authenticatedBackendApiClient);
export const getOrCreateDirectConversation = new GetOrCreateDirectConversation(repository);
export const getDirectInboxPage = new GetDirectInboxPage(repository);
export const getDirectMessagesPage = new GetDirectMessagesPage(repository);
export const sendDirectMessage = new SendDirectMessage(repository);
export const createDirectMessageId = new CreateDirectMessageId(expoUuidGenerator);
