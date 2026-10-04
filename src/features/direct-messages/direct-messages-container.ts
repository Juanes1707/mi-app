import { SupabaseAccessTokenProvider } from '@/features/auth/data/providers/supabase-access-token-provider';
import { DirectInboxRealtimeSignal } from '@/features/direct-messages/application/direct-inbox-realtime-signal';
import { DirectMessageReceiptCoordinator } from '@/features/direct-messages/application/direct-message-receipt-coordinator';
import {
  CreateDirectMessageId, GetDirectInboxPage, GetDirectMessage, GetDirectMessagesPage,
  GetOrCreateDirectConversation, MarkDirectMessageReceipt, SendDirectMessage,
} from '@/features/direct-messages/application/direct-message-use-cases';
import { BackendDirectMessagesRepository } from '@/features/direct-messages/data/backend-direct-messages-repository';
import {
  SupabaseDirectConversationRealtimeSource, SupabaseDirectInboxRealtimeSource,
} from '@/features/direct-messages/data/supabase-direct-message-realtime-source';
import type {
  DirectConversationRealtimeSource, DirectInboxRealtimeSource,
} from '@/features/direct-messages/domain/direct-message-realtime';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';
import { supabase } from '@/infrastructure/supabase/supabase-client';
import { expoUuidGenerator } from '@/shared/infrastructure/expo-uuid-generator';

const repository = new BackendDirectMessagesRepository(authenticatedBackendApiClient);
export const getOrCreateDirectConversation = new GetOrCreateDirectConversation(repository);
export const getDirectInboxPage = new GetDirectInboxPage(repository);
export const getDirectMessagesPage = new GetDirectMessagesPage(repository);
export const getDirectMessage = new GetDirectMessage(repository);
export const sendDirectMessage = new SendDirectMessage(repository);
export const createDirectMessageId = new CreateDirectMessageId(expoUuidGenerator);
export const directMessageReceipts = new DirectMessageReceiptCoordinator(new MarkDirectMessageReceipt(repository));
export const directInboxRealtimeSignal = new DirectInboxRealtimeSignal();

// The shared Supabase client is used ONLY as Realtime transport here (controlled
// exception, like Comments): message content always comes from the authorized HTTP API.
const accessTokens = new SupabaseAccessTokenProvider();
export const directConversationRealtimeSource: DirectConversationRealtimeSource =
  new SupabaseDirectConversationRealtimeSource(supabase, accessTokens);
export const directInboxRealtimeSource: DirectInboxRealtimeSource =
  new SupabaseDirectInboxRealtimeSource(supabase, accessTokens);
