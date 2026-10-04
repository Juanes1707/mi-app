import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createDirectMessageId, getDirectMessagesPage, sendDirectMessage,
} from '@/features/direct-messages/direct-messages-container';
import type { DirectMessage, DirectMessagesPage } from '@/features/direct-messages/domain/direct-message';
import { DirectMessagesError } from '@/features/direct-messages/domain/direct-messages-error';
import { compareDirectPositions, isValidDirectMessageBody } from '@/features/direct-messages/domain/direct-message-values';

// draftRevision: the composer revision this intention was created from (see Draft).
type PendingSend = { messageId: string; body: string; draftRevision: number; status: 'sending' | 'error' };
// The text alone is no identity: a NEW draft can spell exactly what was just sent.
// Every write gets a revision from a counter that never goes back, not even on a
// scope change, so a revision identifies one composer state for the hook's lifetime.
type Draft = { text: string; revision: number };
type ConversationState = {
  ownerUserId: string; conversationId: string;
  status: 'loading' | 'ready' | 'error' | 'not-found';
  page: DirectMessagesPage;
  operation: 'idle' | 'initial' | 'refreshing' | 'loading-more';
  error: DirectMessagesError | null;
  refreshError: DirectMessagesError | null;
  loadMoreError: DirectMessagesError | null;
};
const emptyPage: DirectMessagesPage = { messages: [], nextCursor: null };
const normalizeError = (value: unknown) => value instanceof DirectMessagesError
  ? value : new DirectMessagesError('unavailable');

export function useDirectConversation(ownerUserId: string, conversationId: string) {
  const [state, setState] = useState<ConversationState>(() => initial(ownerUserId, conversationId));
  const [draft, setDraftState] = useState<Draft>({ text: '', revision: 0 });
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const stateRef = useRef(state);
  const draftRef = useRef(draft);
  const draftRevisionRef = useRef(0);
  const pendingRef = useRef(pendingSend);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const scopeRef = useRef(`${ownerUserId}:${conversationId}`);
  scopeRef.current = `${ownerUserId}:${conversationId}`;
  const publish = useCallback((next: ConversationState) => { stateRef.current = next; setState(next); }, []);
  const publishPending = useCallback((next: PendingSend | null) => { pendingRef.current = next; setPendingSend(next); }, []);
  const publishDraft = useCallback((text: string) => {
    draftRevisionRef.current += 1;
    const next = { text, revision: draftRevisionRef.current };
    draftRef.current = next; setDraftState(next);
  }, []);
  const current = useCallback((generation: number) => mountedRef.current &&
    generationRef.current === generation && stateRef.current.ownerUserId === ownerUserId &&
    stateRef.current.conversationId === conversationId, [ownerUserId, conversationId]);
  const currentScope = useCallback(() => mountedRef.current &&
    scopeRef.current === `${ownerUserId}:${conversationId}`, [ownerUserId, conversationId]);

  const loadFirst = useCallback(async () => {
    const previous = stateRef.current;
    if (!mountedRef.current || previous.ownerUserId !== ownerUserId || previous.conversationId !== conversationId ||
        previous.operation === 'initial' || previous.operation === 'refreshing') return false;
    const generation = ++generationRef.current;
    const hasPage = previous.status === 'ready';
    publish({ ...previous, status: hasPage ? 'ready' : 'loading',
      operation: hasPage ? 'refreshing' : 'initial', error: null, refreshError: null, loadMoreError: null });
    try {
      const page = await getDirectMessagesPage.execute(ownerUserId, conversationId, null);
      if (!current(generation)) return false;
      const messages = keepNewerKnownMessages(page.messages, stateRef.current.page.messages);
      publish({ ownerUserId, conversationId, status: 'ready', page: { ...page, messages }, operation: 'idle',
        error: null, refreshError: null, loadMoreError: null });
      return true;
    } catch (error: unknown) {
      if (!current(generation)) return false;
      const normalized = normalizeError(error);
      // The latest state, not `previous`: a send confirmed during the failed read stays.
      const latest = stateRef.current;
      if (normalized.code === 'conversation-not-found') {
        publish({ ...latest, status: 'not-found', page: emptyPage, operation: 'idle', error: normalized,
          refreshError: null, loadMoreError: null });
      } else {
        publish({ ...latest, status: hasPage ? 'ready' : 'error', operation: 'idle',
          error: hasPage ? null : normalized, refreshError: hasPage ? normalized : null, loadMoreError: null });
      }
      return false;
    }
  }, [ownerUserId, conversationId, current, publish]);

  const loadMore = useCallback(async (retry = false) => {
    const previous = stateRef.current;
    if (!mountedRef.current || previous.ownerUserId !== ownerUserId || previous.conversationId !== conversationId ||
        previous.status !== 'ready' || previous.operation !== 'idle' ||
        previous.page.nextCursor === null || (previous.loadMoreError !== null && !retry)) return;
    const generation = generationRef.current;
    publish({ ...previous, operation: 'loading-more', loadMoreError: null });
    try {
      const page = await getDirectMessagesPage.execute(ownerUserId, conversationId, previous.page.nextCursor);
      if (!current(generation)) return;
      // Re-read the state: a send confirmed while this page was loading must survive.
      const latest = stateRef.current;
      publish({ ...latest, page: { messages: mergeMessages(latest.page.messages, page.messages),
        nextCursor: page.nextCursor }, operation: 'idle', loadMoreError: null });
    } catch (error: unknown) {
      if (!current(generation)) return;
      const normalized = normalizeError(error);
      const latest = stateRef.current;
      if (normalized.code === 'conversation-not-found') {
        publish({ ...latest, status: 'not-found', page: emptyPage, operation: 'idle', error: normalized,
          refreshError: null, loadMoreError: null });
      } else publish({ ...latest, operation: 'idle', loadMoreError: normalized });
    }
  }, [ownerUserId, conversationId, current, publish]);

  const attemptSend = useCallback(async (intention: PendingSend) => {
    if (!mountedRef.current || pendingRef.current?.status === 'sending') return;
    publishPending({ ...intention, status: 'sending' });
    try {
      const message = await sendDirectMessage.execute(
        ownerUserId, conversationId, intention.messageId, intention.body,
      );
      if (!currentScope() || pendingRef.current?.messageId !== intention.messageId) return;
      const previous = stateRef.current;
      if (previous.status === 'ready') {
        publish({ ...previous, page: { ...previous.page, messages: mergeMessage(previous.page.messages, message) } });
      }
      publishPending(null);
      // Cleared only if the composer is still the very revision that was sent: any
      // edit made meanwhile stays, even one that ends in the same text.
      const latestDraft = draftRef.current;
      if (latestDraft.revision === intention.draftRevision && latestDraft.text === intention.body) publishDraft('');
    } catch (error: unknown) {
      if (!currentScope() || pendingRef.current?.messageId !== intention.messageId) return;
      const normalized = normalizeError(error);
      if (normalized.code === 'conversation-not-found') {
        generationRef.current += 1;
        publish({ ...stateRef.current, status: 'not-found', page: emptyPage, operation: 'idle', error: normalized,
          refreshError: null, loadMoreError: null });
      }
      publishPending({ ...intention, status: 'error' });
    }
  }, [ownerUserId, conversationId, currentScope, publish, publishPending, publishDraft]);

  const send = useCallback(() => {
    // Text and revision are read together from the ref: the intention is one composer state.
    const composer = draftRef.current;
    if (pendingRef.current !== null || !isValidDirectMessageBody(composer.text)) return;
    const intention: PendingSend = {
      messageId: createDirectMessageId.execute(), body: composer.text, draftRevision: composer.revision, status: 'error',
    };
    void attemptSend(intention);
  }, [attemptSend]);
  const retrySend = useCallback(() => {
    const intention = pendingRef.current;
    if (intention?.status === 'error') void attemptSend(intention);
  }, [attemptSend]);
  const discardFailedSend = useCallback(() => {
    if (pendingRef.current?.status === 'error') publishPending(null);
  }, [publishPending]);
  // Every onChangeText is a user edit (Android does not emit identical replacements),
  // so each call is a new revision, even when it ends in a previously sent text.
  const setDraft = useCallback((value: string) => {
    if (pendingRef.current?.status === 'error' && value !== pendingRef.current.body) publishPending(null);
    publishDraft(value);
  }, [publishDraft, publishPending]);

  // A canonical message read after a Realtime hint, merged into the LATEST state like
  // any page item (duplicates are no-ops). During the first load it joins the empty
  // page and survives that load (keepNewerKnownMessages); a not-found chat takes none.
  const mergeLiveMessage = useCallback((message: DirectMessage) => {
    if (!mountedRef.current) return;
    const latest = stateRef.current;
    if (latest.ownerUserId !== ownerUserId || latest.conversationId !== conversationId ||
        message.conversationId !== conversationId || latest.status === 'not-found') return;
    let messages: DirectMessage[];
    try {
      messages = mergeMessage(latest.page.messages, message);
    } catch {
      return;
    }
    if (messages !== latest.page.messages) publish({ ...latest, page: { ...latest.page, messages } });
  }, [ownerUserId, conversationId, publish]);

  useEffect(() => {
    mountedRef.current = true;
    const next = initial(ownerUserId, conversationId);
    stateRef.current = next; setState(next); pendingRef.current = null; setPendingSend(null); publishDraft('');
    void loadFirst();
    return () => { mountedRef.current = false; generationRef.current += 1; stateRef.current.operation = 'idle'; };
  }, [ownerUserId, conversationId, loadFirst, publishDraft]);

  return {
    state: state.ownerUserId === ownerUserId && state.conversationId === conversationId
      ? state : initial(ownerUserId, conversationId),
    draft: draft.text, setDraft, pendingSend, send, retrySend, discardFailedSend, mergeLiveMessage,
    refresh: loadFirst, retry: loadFirst,
    onEndReached: useCallback(() => { void loadMore(); }, [loadMore]),
    retryLoadMore: useCallback(() => { void loadMore(true); }, [loadMore]),
  };
}

function initial(ownerUserId: string, conversationId: string): ConversationState {
  return { ownerUserId, conversationId, status: 'loading', page: emptyPage, operation: 'idle',
    error: null, refreshError: null, loadMoreError: null };
}
export function mergeMessage(messages: DirectMessage[], message: DirectMessage): DirectMessage[] {
  return mergeMessages(messages, [message]);
}
// Same id must mean the same message: identity, body and createdAt never change, and
// an incompatible copy is rejected, never overwritten. Receipt timestamps are the one
// exception: they only ever go from null to a value (never rewritten server-side),
// so a newer canonical copy may fill them.
export function mergeMessages(messages: DirectMessage[], incoming: DirectMessage[]): DirectMessage[] {
  const byId = new Map(messages.map((item) => [item.id, item]));
  let changed = false;
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (existing === undefined) {
      byId.set(message.id, message);
      changed = true;
      continue;
    }
    const merged = withAdvancedReceipts(existing, message);
    if (merged !== existing) {
      byId.set(message.id, merged);
      changed = true;
    }
  }
  if (!changed) return messages;
  return [...byId.values()].sort((left, right) => {
    const order = compareDirectPositions(left, right);
    if (order === null) throw new DirectMessagesError('invalid-response');
    return order;
  });
}
function withAdvancedReceipts(existing: DirectMessage, incoming: DirectMessage): DirectMessage {
  if (existing.conversationId !== incoming.conversationId || existing.senderId !== incoming.senderId ||
      existing.body !== incoming.body || !sameInstant(existing.createdAt, incoming.createdAt)) {
    throw new DirectMessagesError('invalid-response');
  }
  const deliveredAt = advancedReceipt(existing.deliveredAt, incoming.deliveredAt);
  const readAt = advancedReceipt(existing.readAt, incoming.readAt);
  return deliveredAt === existing.deliveredAt && readAt === existing.readAt
    ? existing : { ...existing, deliveredAt, readAt };
}
function advancedReceipt(current: string | null, incoming: string | null): string | null {
  if (current === null) return incoming;
  if (incoming === null || sameInstant(current, incoming)) return current;
  throw new DirectMessagesError('invalid-response');
}
function sameInstant(left: string, right: string): boolean {
  return left === right || compareDirectPositions({ createdAt: left, id: '' }, { createdAt: right, id: '' }) === 0;
}
// A send confirmed while a first-page read was in flight can be newer than that
// read's snapshot. Messages are never deleted, so it is kept instead of vanishing.
function keepNewerKnownMessages(fresh: DirectMessage[], known: DirectMessage[]): DirectMessage[] {
  const newest = fresh[0];
  if (newest === undefined) return mergeMessages(fresh, known);
  return mergeMessages(fresh, known.filter((message) => (compareDirectPositions(message, newest) ?? 1) < 0));
}
