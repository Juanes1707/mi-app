import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccessTokenProvider } from '@/features/auth/application/ports/access-token-provider';
import {
  DirectRealtimeError,
  type DirectConversationRealtimeSource,
  type DirectConversationRealtimeSubscription,
  type DirectInboxRealtimeSource,
  type DirectInboxRealtimeSubscription,
  type DirectMessageCreatedEvent,
  type DirectMessageReceiptEvent,
  type DirectRealtimeStatus,
  type DirectTypingEvent,
} from '@/features/direct-messages/domain/direct-message-realtime';
import { isDirectTimestamp, normalizeDirectUuid } from '@/features/direct-messages/domain/direct-message-values';
import {
  AuthenticatedUserMismatchError,
  AuthenticationRequiredError,
  requireAccessTokenOf,
} from '@/infrastructure/api/authenticated-backend-api-client';

// The only Supabase surface Direct Messages uses: Realtime transport. No table reads,
// no RPC, no Postgres Changes, no Presence.
export type RealtimeTransport = Pick<SupabaseClient, 'channel' | 'removeChannel' | 'realtime'>;
type Channel = ReturnType<RealtimeTransport['channel']>;

export const DIRECT_CONVERSATION_TOPIC_PREFIX = 'direct-conversation:';
export const DIRECT_TYPING_TOPIC_PREFIX = 'direct-typing:';
export const DIRECT_INBOX_TOPIC_PREFIX = 'direct-inbox:';
export const MESSAGE_CREATED_EVENT = 'message-created';
export const MESSAGE_RECEIPT_EVENT = 'message-receipt';
export const TYPING_EVENT = 'typing';

const MESSAGE_CREATED_FIELDS = ['conversationId', 'messageId', 'senderId', 'createdAt'];
const RECEIPT_FIELDS = ['conversationId', 'messageSenderId', 'throughMessageId', 'throughCreatedAt', 'kind', 'at'];
const TYPING_FIELDS = ['conversationId', 'isTyping'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Supabase Realtime adds the realtime.messages row id to every broadcast sent from the
// database (realtime.send). It is transport metadata: tolerated only as a UUID.
export const REALTIME_MESSAGE_ID_KEY = 'id';

// A Broadcast message is untrusted input: the expected event and exactly these
// payload keys (plus Realtime's own `id`), or it is dropped silently (no request, no
// state change). Any other extra key, such as a smuggled body, is still rejected.
function exactPayload(message: unknown, event: string, fields: string[]): Record<string, unknown> | null {
  if (!isRecord(message) || message.event !== event || !isRecord(message.payload)) return null;
  const payload = message.payload;
  const keys = Object.keys(payload);
  const extra = keys.filter((key) => !fields.includes(key));
  if (!fields.every((field) => keys.includes(field))) return null;
  if (extra.length > 1 || (extra.length === 1 &&
      (extra[0] !== REALTIME_MESSAGE_ID_KEY || normalizeDirectUuid(payload[REALTIME_MESSAGE_ID_KEY]) === null))) {
    return null;
  }
  return payload;
}

// expectedConversationId null: the inbox topic, whose hints may name any conversation.
export function parseMessageCreatedMessage(message: unknown, expectedConversationId: string | null): DirectMessageCreatedEvent | null {
  const payload = exactPayload(message, MESSAGE_CREATED_EVENT, MESSAGE_CREATED_FIELDS);
  if (payload === null) return null;
  const conversationId = normalizeDirectUuid(payload.conversationId);
  const messageId = normalizeDirectUuid(payload.messageId);
  const senderId = normalizeDirectUuid(payload.senderId);
  const { createdAt } = payload;
  if (conversationId === null || messageId === null || senderId === null || !isDirectTimestamp(createdAt) ||
      (expectedConversationId !== null && conversationId !== expectedConversationId)) return null;
  return { conversationId, messageId, senderId, createdAt };
}

export function parseReceiptMessage(message: unknown, expectedConversationId: string): DirectMessageReceiptEvent | null {
  const payload = exactPayload(message, MESSAGE_RECEIPT_EVENT, RECEIPT_FIELDS);
  if (payload === null) return null;
  const conversationId = normalizeDirectUuid(payload.conversationId);
  const messageSenderId = normalizeDirectUuid(payload.messageSenderId);
  const throughMessageId = normalizeDirectUuid(payload.throughMessageId);
  const { throughCreatedAt, kind, at } = payload;
  if (conversationId !== expectedConversationId || messageSenderId === null || throughMessageId === null ||
      !isDirectTimestamp(throughCreatedAt) || !isDirectTimestamp(at) || (kind !== 'delivered' && kind !== 'read')) return null;
  return { conversationId, messageSenderId, throughMessageId, throughCreatedAt, kind, at };
}

export function parseTypingMessage(message: unknown, expectedConversationId: string): DirectTypingEvent | null {
  const payload = exactPayload(message, TYPING_EVENT, TYPING_FIELDS);
  if (payload === null || typeof payload.isTyping !== 'boolean' ||
      normalizeDirectUuid(payload.conversationId) !== expectedConversationId) return null;
  return { conversationId: expectedConversationId, isTyping: payload.isTyping };
}

function toStatus(status: string): DirectRealtimeStatus | null {
  switch (status) {
    case 'SUBSCRIBED':
      return 'subscribed';
    case 'CHANNEL_ERROR':
      return 'channel-error';
    case 'TIMED_OUT':
      return 'timed-out';
    case 'CLOSED':
      return 'closed';
    default:
      return null;
  }
}

// supabase.channel(topic) returns an EXISTING channel with the same topic, so a new
// subscription waits until the previous one for that topic is fully removed.
class TopicRemovals {
  private readonly removals = new Map<string, Promise<void>>();

  constructor(private readonly transport: RealtimeTransport) {}

  async waitFor(topics: string[]): Promise<void> {
    await Promise.all(topics.map((topic) => this.removals.get(topic)));
  }

  remove(topic: string, channel: Channel): Promise<void> {
    const done = this.transport.removeChannel(channel).then(() => undefined, () => undefined);
    const removal: Promise<void> = done.finally(() => {
      if (this.removals.get(topic) === removal) this.removals.delete(topic);
    });
    this.removals.set(topic, removal);
    return removal;
  }
}

// Read the session token ONCE, check its subject is the expected owner, and give
// THAT token to the socket before any channel exists. The shared client may later
// refresh the socket token from the current session, so callers still guard every
// callback with their own owner generation.
async function authorizeSocketFor(
  transport: RealtimeTransport, accessTokens: AccessTokenProvider, owner: string,
): Promise<void> {
  let token: string;
  try {
    token = await requireAccessTokenOf(accessTokens, owner);
  } catch (error: unknown) {
    if (error instanceof AuthenticatedUserMismatchError) throw new DirectRealtimeError('owner-session-mismatch');
    if (error instanceof AuthenticationRequiredError) throw new DirectRealtimeError('authentication-required');
    throw new DirectRealtimeError('unavailable');
  }
  try {
    await transport.realtime.setAuth(token);
  } catch {
    throw new DirectRealtimeError('unavailable');
  }
}

// Two private channels per (owner, conversation):
//   direct-conversation:<id>  receive-only server hints (no send API exists for it);
//   direct-typing:<id>        typing only, self=false, ack=false (best effort).
// Join authorization is the server's (RLS on realtime.messages). Reconnection is left
// to the Supabase client: no timers here.
export class SupabaseDirectConversationRealtimeSource implements DirectConversationRealtimeSource {
  private readonly removals: TopicRemovals;

  constructor(
    private readonly transport: RealtimeTransport,
    private readonly accessTokens: AccessTokenProvider,
  ) {
    this.removals = new TopicRemovals(transport);
  }

  async subscribe({
    expectedOwnerUserId, conversationId, onMessageCreated, onReceipt, onTyping, onStatus,
  }: Parameters<DirectConversationRealtimeSource['subscribe']>[0]): Promise<DirectConversationRealtimeSubscription> {
    const owner = normalizeDirectUuid(expectedOwnerUserId);
    const conversation = normalizeDirectUuid(conversationId);
    if (owner === null || conversation === null) throw new DirectRealtimeError('invalid-request');
    const serverTopic = `${DIRECT_CONVERSATION_TOPIC_PREFIX}${conversation}`;
    const typingTopic = `${DIRECT_TYPING_TOPIC_PREFIX}${conversation}`;

    await this.removals.waitFor([serverTopic, typingTopic]);
    await authorizeSocketFor(this.transport, this.accessTokens, owner);

    let active = true;
    let typingJoined = false;

    const server = this.transport.channel(serverTopic, { config: { private: true } });
    server.on('broadcast', { event: MESSAGE_CREATED_EVENT }, (message: unknown) => {
      if (!active) return;
      const event = parseMessageCreatedMessage(message, conversation);
      if (event !== null) onMessageCreated(event);
    });
    server.on('broadcast', { event: MESSAGE_RECEIPT_EVENT }, (message: unknown) => {
      if (!active) return;
      const event = parseReceiptMessage(message, conversation);
      if (event !== null) onReceipt(event);
    });
    server.subscribe((status) => {
      if (!active) return;
      const mapped = toStatus(status);
      if (mapped !== null) onStatus?.(mapped);
    });

    const typing = this.transport.channel(typingTopic, {
      config: { private: true, broadcast: { self: false, ack: false } },
    });
    typing.on('broadcast', { event: TYPING_EVENT }, (message: unknown) => {
      if (!active) return;
      const event = parseTypingMessage(message, conversation);
      if (event !== null) onTyping(event);
    });
    typing.subscribe((status) => {
      typingJoined = active && toStatus(status) === 'subscribed';
    });

    let removal: Promise<void> | null = null;
    return {
      sendTyping: (isTyping: boolean) => {
        // Only over a joined socket: never the REST fallback, never another event.
        if (!active || !typingJoined) return false;
        const payload: DirectTypingEvent = { conversationId: conversation, isTyping };
        void typing.send({ type: 'broadcast', event: TYPING_EVENT, payload }).catch(() => undefined);
        return true;
      },
      unsubscribe: () => {
        if (removal !== null) return removal;
        active = false;
        typingJoined = false;
        removal = Promise.all([
          this.removals.remove(serverTopic, server),
          this.removals.remove(typingTopic, typing),
        ]).then(() => undefined);
        return removal;
      },
    };
  }
}

// direct-inbox:<owner>: receive-only new-message hints for the owner's own inbox.
export class SupabaseDirectInboxRealtimeSource implements DirectInboxRealtimeSource {
  private readonly removals: TopicRemovals;

  constructor(
    private readonly transport: RealtimeTransport,
    private readonly accessTokens: AccessTokenProvider,
  ) {
    this.removals = new TopicRemovals(transport);
  }

  async subscribe({
    expectedOwnerUserId, onMessageCreated, onStatus,
  }: Parameters<DirectInboxRealtimeSource['subscribe']>[0]): Promise<DirectInboxRealtimeSubscription> {
    const owner = normalizeDirectUuid(expectedOwnerUserId);
    if (owner === null) throw new DirectRealtimeError('invalid-request');
    const topic = `${DIRECT_INBOX_TOPIC_PREFIX}${owner}`;

    await this.removals.waitFor([topic]);
    await authorizeSocketFor(this.transport, this.accessTokens, owner);

    let active = true;
    const channel = this.transport.channel(topic, { config: { private: true } });
    channel.on('broadcast', { event: MESSAGE_CREATED_EVENT }, (message: unknown) => {
      if (!active) return;
      const event = parseMessageCreatedMessage(message, null);
      if (event !== null) onMessageCreated(event);
    });
    channel.subscribe((status) => {
      if (!active) return;
      const mapped = toStatus(status);
      if (mapped !== null) onStatus?.(mapped);
    });

    let removal: Promise<void> | null = null;
    return {
      unsubscribe: () => {
        if (removal !== null) return removal;
        active = false;
        removal = this.removals.remove(topic, channel);
        return removal;
      },
    };
  }
}
