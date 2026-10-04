import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  directConversationRealtimeSource, directMessageReceipts, getDirectMessage,
} from '@/features/direct-messages/direct-messages-container';
import type { DirectMessage } from '@/features/direct-messages/domain/direct-message';
import type {
  DirectConversationRealtimeSubscription, DirectRealtimeStatus,
} from '@/features/direct-messages/domain/direct-message-realtime';
import {
  advanceReceiptOverlay, EMPTY_RECEIPT_OVERLAY, type ReceiptOverlay,
} from '@/features/direct-messages/presentation/receipt-overlay';

// The ONLY timers of the live chat, both for ephemeral typing (no polling, no retry):
// - local idle: no edit for this long sends typing=false;
// - remote expiry: a peer "typing" without news for this long is cleared, so a lost
//   false (dropped packet, disconnect) never leaves the indicator stuck.
export const TYPING_IDLE_MS = 1300;
export const PEER_TYPING_EXPIRY_MS = 3000;
// Continuous typing re-announces true at most this often, driven by edits (not by a
// timer), so the peer's expiry does not hide an indicator that is still true.
export const TYPING_REFRESH_MS = 1500;

type LiveState = {
  owner: string;
  conversationId: string;
  overlay: ReceiptOverlay;
  peerTyping: boolean;
  status: DirectRealtimeStatus | null;
};

function initialLive(owner: string, conversationId: string): LiveState {
  return { owner, conversationId, overlay: EMPTY_RECEIPT_OVERLAY, peerTyping: false, status: null };
}

type Options = {
  ownerUserId: string;
  conversationId: string;
  // The chat is the screen the user is looking at: only then are messages "read".
  focused: boolean;
  // History loaded (the HTTP page is the base the live layer completes).
  ready: boolean;
  // Newest first, the canonical page of the chat hook.
  messages: DirectMessage[];
  mergeLiveMessage(message: DirectMessage): void;
};

// Live layer of one chat. Realtime only HINTS; content and receipts stay canonical:
// - message-created -> one owner-bound GET /direct-message -> canonical merge
//   (duplicates in flight or already loaded cost nothing; the own message sent over
//   HTTP and its broadcast end up as one bubble);
// - message-receipt of the owner's messages -> forward-only watermarks (overlay);
// - typing -> "Escribiendo…" with a safety expiry; local typing is announced once
//   per burst and withdrawn on idle, send, discard, blur, conversation change, unmount;
// - focused + loaded -> read through the newest peer message (coalesced).
// Owner/conversation change or unmount bumps a generation: late events, reads and
// statuses of the previous scope never reach the new one. Realtime failing never
// breaks the HTTP chat; reconnection is the Supabase client's job.
export function useDirectConversationRealtime({
  ownerUserId, conversationId, focused, ready, messages, mergeLiveMessage,
}: Options) {
  const [state, setState] = useState<LiveState>(() => initialLive(ownerUserId, conversationId));
  const stateRef = useRef(state);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const subscriptionRef = useRef<{ generation: number; subscription: DirectConversationRealtimeSubscription } | null>(null);
  const inFlightRef = useRef(new Set<string>());
  const messagesRef = useRef(messages);
  const mergeRef = useRef(mergeLiveMessage);
  const localTypingRef = useRef(false);
  const lastTypingSentAtRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  messagesRef.current = messages;
  mergeRef.current = mergeLiveMessage;

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = null;
  }, []);
  const clearPeerTimer = useCallback(() => {
    if (peerTimerRef.current !== null) clearTimeout(peerTimerRef.current);
    peerTimerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      clearIdleTimer();
      clearPeerTimer();
    };
  }, [clearIdleTimer, clearPeerTimer]);

  const commit = useCallback((update: (current: LiveState) => LiveState) => {
    if (!mountedRef.current) return;
    const next = update(stateRef.current);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const isCurrent = useCallback(
    (generation: number) => mountedRef.current && generationRef.current === generation, [],
  );

  const setPeerTyping = useCallback((generation: number, isTyping: boolean) => {
    clearPeerTimer();
    if (isTyping) {
      peerTimerRef.current = setTimeout(() => {
        peerTimerRef.current = null;
        if (isCurrent(generation)) commit((current) => (current.peerTyping ? { ...current, peerTyping: false } : current));
      }, PEER_TYPING_EXPIRY_MS);
    }
    commit((current) => (current.peerTyping === isTyping ? current : { ...current, peerTyping: isTyping }));
  }, [clearPeerTimer, commit, isCurrent]);

  // One authorized read per hinted id: in flight or already in the page -> nothing.
  const readCanonical = useCallback((generation: number, owner: string, conversation: string, messageId: string) => {
    const inFlight = inFlightRef.current;
    if (inFlight.has(messageId) || messagesRef.current.some((message) => message.id === messageId)) return;
    inFlight.add(messageId);
    let read: Promise<DirectMessage>;
    try {
      read = getDirectMessage.execute(owner, conversation, messageId);
    } catch {
      inFlight.delete(messageId);
      return;
    }
    read.then(
      (message) => {
        inFlight.delete(messageId);
        if (!isCurrent(generation) || message.conversationId !== conversation || message.id !== messageId) return;
        mergeRef.current(message);
      },
      () => {
        // Not found / no access / network: nothing shown, nothing retried. The next
        // history load or focus refresh is the reconciliation.
        inFlight.delete(messageId);
      },
    );
  }, [isCurrent]);

  const stopTyping = useCallback(() => {
    clearIdleTimer();
    if (!localTypingRef.current) return;
    localTypingRef.current = false;
    const live = subscriptionRef.current;
    if (live !== null && live.generation === generationRef.current) live.subscription.sendTyping(false);
  }, [clearIdleTimer]);

  // Observes user edits of the composer (the draft and its revision stay owned by the
  // chat hook): true once per burst, the idle timer restarted on every edit.
  const notifyDraftEdited = useCallback((text: string) => {
    if (text.trim() === '') {
      stopTyping();
      return;
    }
    const live = subscriptionRef.current;
    if (live === null || live.generation !== generationRef.current) return;
    const now = Date.now();
    if (!localTypingRef.current || now - lastTypingSentAtRef.current >= TYPING_REFRESH_MS) {
      if (live.subscription.sendTyping(true)) {
        localTypingRef.current = true;
        lastTypingSentAtRef.current = now;
      }
    }
    if (!localTypingRef.current) return;
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      stopTyping();
    }, TYPING_IDLE_MS);
  }, [clearIdleTimer, stopTyping]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    inFlightRef.current = new Set();
    localTypingRef.current = false;
    lastTypingSentAtRef.current = 0;
    clearIdleTimer();
    clearPeerTimer();
    commit(() => initialLive(ownerUserId, conversationId));
    const owner = ownerUserId;
    const conversation = conversationId;
    let disposed = false;
    const current = () => !disposed && isCurrent(generation);

    directConversationRealtimeSource.subscribe({
      expectedOwnerUserId: owner,
      conversationId: conversation,
      onMessageCreated: (event) => {
        if (!current()) return;
        if (event.senderId !== owner) setPeerTyping(generation, false);
        readCanonical(generation, owner, conversation, event.messageId);
      },
      onReceipt: (event) => {
        // Receipts only matter to the author of the acknowledged messages.
        if (!current() || event.messageSenderId !== owner) return;
        commit((state) => {
          const overlay = advanceReceiptOverlay(state.overlay, event);
          return overlay === state.overlay ? state : { ...state, overlay };
        });
      },
      onTyping: (event) => {
        if (!current()) return;
        setPeerTyping(generation, event.isTyping);
      },
      onStatus: (status) => {
        if (!current()) return;
        commit((state) => (state.status === status ? state : { ...state, status }));
      },
    }).then(
      (subscription) => {
        if (!current()) {
          void subscription.unsubscribe();
          return;
        }
        subscriptionRef.current = { generation, subscription };
      },
      () => {
        // Not joined: the chat works over HTTP alone. No retry timer.
      },
    );

    return () => {
      disposed = true;
      clearIdleTimer();
      clearPeerTimer();
      const live = subscriptionRef.current;
      if (live !== null && live.generation === generation) {
        subscriptionRef.current = null;
        // Best effort: leaving while typing withdraws the indicator first.
        if (localTypingRef.current) live.subscription.sendTyping(false);
        void live.subscription.unsubscribe();
      }
      localTypingRef.current = false;
    };
  }, [ownerUserId, conversationId, clearIdleTimer, clearPeerTimer, commit, isCurrent, readCanonical, setPeerTyping]);

  // Read = the user is looking at this chat. The newest PEER message is the
  // high-watermark; unread older ones are covered by it. Not focused: never read.
  useEffect(() => {
    if (!focused || !ready) return;
    const newestPeer = messages.find((message) =>
      message.conversationId === conversationId && message.senderId !== ownerUserId);
    if (newestPeer === undefined || newestPeer.readAt !== null) return;
    directMessageReceipts.request(ownerUserId, conversationId,
      { messageId: newestPeer.id, createdAt: newestPeer.createdAt }, 'read');
  }, [focused, ready, messages, ownerUserId, conversationId]);

  const visible = useMemo(
    () => (state.owner === ownerUserId && state.conversationId === conversationId
      ? state : initialLive(ownerUserId, conversationId)),
    [state, ownerUserId, conversationId],
  );

  return {
    overlay: visible.overlay,
    peerTyping: visible.peerTyping,
    status: visible.status,
    notifyDraftEdited,
    stopTyping,
  };
}
