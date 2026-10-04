import type { DirectMessageReceiptKind } from '@/features/direct-messages/domain/direct-message';

// Live HINTS, never content: "conversation C has message M by S at T". Every hint is
// re-read through the authorized HTTP read model before anything is shown, so it
// grants nothing. Transport details (Supabase Realtime) stay in the data layer.
export type DirectMessageCreatedEvent = {
  conversationId: string;
  messageId: string;
  senderId: string;
  createdAt: string;
};

// "The messages of messageSenderId up to (throughCreatedAt, throughMessageId) are now
// delivered/read." Only shown to that sender, as a live watermark over its messages.
export type DirectMessageReceiptEvent = {
  conversationId: string;
  messageSenderId: string;
  throughMessageId: string;
  throughCreatedAt: string;
  kind: DirectMessageReceiptKind;
  at: string;
};

// Ephemeral, from the only other participant (the channel never echoes our own).
export type DirectTypingEvent = { conversationId: string; isTyping: boolean };

export type DirectRealtimeStatus = 'subscribed' | 'channel-error' | 'timed-out' | 'closed';

export type DirectRealtimeErrorCode =
  | 'invalid-request' | 'authentication-required' | 'owner-session-mismatch' | 'unavailable';

export class DirectRealtimeError extends Error {
  constructor(readonly code: DirectRealtimeErrorCode) {
    super(`Direct messages realtime failed: ${code}.`);
    this.name = 'DirectRealtimeError';
  }
}

export type DirectConversationRealtimeSubscription = {
  // Best effort, only the typing event exists: false when it could not be handed to
  // a joined channel (the caller may try again on the next edit).
  sendTyping(isTyping: boolean): boolean;
  // Idempotent: both channels are removed once; no callback runs afterwards.
  unsubscribe(): Promise<void>;
};

// One logical live link per (owner, conversation): receive-only server hints plus
// the typing side-channel, joined with the session of the expected owner.
export interface DirectConversationRealtimeSource {
  subscribe(input: {
    expectedOwnerUserId: string;
    conversationId: string;
    onMessageCreated(event: DirectMessageCreatedEvent): void;
    onReceipt(event: DirectMessageReceiptEvent): void;
    onTyping(event: DirectTypingEvent): void;
    onStatus?(status: DirectRealtimeStatus): void;
  }): Promise<DirectConversationRealtimeSubscription>;
}

export type DirectInboxRealtimeSubscription = { unsubscribe(): Promise<void> };

// Receive-only: new-message hints for the owner's own inbox. No send exists.
export interface DirectInboxRealtimeSource {
  subscribe(input: {
    expectedOwnerUserId: string;
    onMessageCreated(event: DirectMessageCreatedEvent): void;
    onStatus?(status: DirectRealtimeStatus): void;
  }): Promise<DirectInboxRealtimeSubscription>;
}
