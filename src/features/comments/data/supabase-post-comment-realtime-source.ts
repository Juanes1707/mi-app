import type { SupabaseClient } from '@supabase/supabase-js';

import type { AccessTokenProvider } from '@/features/auth/application/ports/access-token-provider';
import {
  PostCommentRealtimeError,
  type PostCommentCreatedEvent,
  type PostCommentRealtimeSource,
  type PostCommentRealtimeStatus,
  type PostCommentRealtimeSubscription,
} from '@/features/comments/domain/post-comment-realtime';
import { isUuid } from '@/features/comments/domain/post-comment-values';
import {
  AuthenticatedUserMismatchError,
  AuthenticationRequiredError,
  requireAccessTokenOf,
} from '@/infrastructure/api/authenticated-backend-api-client';

// The only Supabase surface this feature uses: Realtime transport. No table reads.
export type RealtimeTransport = Pick<SupabaseClient, 'channel' | 'removeChannel' | 'realtime'>;

export const POST_COMMENTS_TOPIC_PREFIX = 'post-comments:';
export const COMMENT_CREATED_EVENT = 'comment-created';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A Broadcast message is untrusted input: exactly { postId, commentId }, both UUIDs, for
// the subscribed post. Anything else is dropped silently (no request, no state change).
export function parseCommentCreatedMessage(message: unknown, postId: string): PostCommentCreatedEvent | null {
  if (!isRecord(message) || message.event !== COMMENT_CREATED_EVENT) return null;
  const payload = message.payload;
  if (!isRecord(payload)) return null;
  const keys = Object.keys(payload);
  if (keys.length !== 2 || !keys.includes('postId') || !keys.includes('commentId')) return null;
  const { postId: eventPostId, commentId } = payload;
  if (!isUuid(eventPostId) || !isUuid(commentId) || eventPostId.toLowerCase() !== postId) return null;
  return { postId, commentId: commentId.toLowerCase() };
}

function toStatus(status: string): PostCommentRealtimeStatus | null {
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

// Receive-only private Broadcast per post. The join is authorized by the server (RLS on
// realtime.messages) with the token set here, which was checked to belong to the
// expected owner. Reconnection is left to the Supabase client: no timers here.
export class SupabasePostCommentRealtimeSource implements PostCommentRealtimeSource {
  // supabase.channel(topic) returns an EXISTING channel with the same topic, so a new
  // subscription waits until the previous one for that topic is fully removed.
  private readonly removals = new Map<string, Promise<void>>();

  constructor(
    private readonly transport: RealtimeTransport,
    private readonly accessTokens: AccessTokenProvider,
  ) {}

  async subscribe({
    expectedOwnerUserId, postId, onCommentCreated, onStatus,
  }: Parameters<PostCommentRealtimeSource['subscribe']>[0]): Promise<PostCommentRealtimeSubscription> {
    if (!isUuid(expectedOwnerUserId) || !isUuid(postId)) throw new PostCommentRealtimeError('invalid-request');
    const owner = expectedOwnerUserId.toLowerCase();
    const post = postId.toLowerCase();
    const topic = `${POST_COMMENTS_TOPIC_PREFIX}${post}`;

    await this.removals.get(topic);

    // Read the token once, verify its subject is the owner, and join with THAT token.
    let token: string;
    try {
      token = await requireAccessTokenOf(this.accessTokens, owner);
    } catch (error: unknown) {
      if (error instanceof AuthenticatedUserMismatchError) throw new PostCommentRealtimeError('owner-session-mismatch');
      if (error instanceof AuthenticationRequiredError) throw new PostCommentRealtimeError('authentication-required');
      throw new PostCommentRealtimeError('unavailable');
    }
    try {
      await this.transport.realtime.setAuth(token);
    } catch {
      throw new PostCommentRealtimeError('unavailable');
    }

    let active = true;
    const channel = this.transport.channel(topic, { config: { private: true } });
    channel.on('broadcast', { event: COMMENT_CREATED_EVENT }, (message: unknown) => {
      if (!active) return;
      const event = parseCommentCreatedMessage(message, post);
      if (event !== null) onCommentCreated(event);
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
        const done = this.transport.removeChannel(channel).then(() => undefined, () => undefined);
        removal = done.finally(() => {
          if (this.removals.get(topic) === removal) this.removals.delete(topic);
        });
        this.removals.set(topic, removal);
        return removal;
      },
    };
  }
}
