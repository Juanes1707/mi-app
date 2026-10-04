import { useCallback, useEffect, useRef, useState } from 'react';

import { directInboxRealtimeSignal, getDirectInboxPage } from '@/features/direct-messages/direct-messages-container';
import type { DirectInboxPage } from '@/features/direct-messages/domain/direct-message';
import { DirectMessagesError } from '@/features/direct-messages/domain/direct-messages-error';

type InboxState = {
  ownerUserId: string;
  status: 'loading' | 'ready' | 'error';
  page: DirectInboxPage;
  operation: 'idle' | 'initial' | 'refreshing' | 'loading-more';
  // A refresh triggered by Realtime: no pull-to-refresh spinner for it.
  silent: boolean;
  error: DirectMessagesError | null;
  refreshError: DirectMessagesError | null;
  loadMoreError: DirectMessagesError | null;
};
const emptyPage: DirectInboxPage = { conversations: [], nextCursor: null };
const normalizeError = (value: unknown) => value instanceof DirectMessagesError
  ? value : new DirectMessagesError('unavailable');

function initial(ownerUserId: string): InboxState {
  return { ownerUserId, status: 'loading', page: emptyPage, operation: 'idle', silent: false,
    error: null, refreshError: null, loadMoreError: null };
}

export function useDirectInbox(ownerUserId: string) {
  const [state, setState] = useState<InboxState>(() => initial(ownerUserId));
  const stateRef = useRef(state);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  // A Realtime signal that arrived while a first-page load was running: exactly one
  // more refresh when it ends, however many signals came (no loop, no timer).
  const trailingRefreshRef = useRef(false);
  const publish = useCallback((next: InboxState) => { stateRef.current = next; setState(next); }, []);

  // Always the FIRST page. A realtime refresh therefore resets the loaded pages to the
  // first one with its own cursor: after a reorder an old cursor could skip or repeat
  // conversations, so it is never kept.
  const load = useCallback(async (silent: boolean): Promise<boolean> => {
    if (!mountedRef.current || stateRef.current.ownerUserId !== ownerUserId) return false;
    const previous = stateRef.current;
    if (previous.operation === 'initial' || previous.operation === 'refreshing') return false;
    const generation = ++generationRef.current;
    const hasPage = previous.status === 'ready';
    publish({ ...previous, status: hasPage ? 'ready' : 'loading', silent,
      operation: hasPage ? 'refreshing' : 'initial', error: null, refreshError: null, loadMoreError: null });
    let loaded = false;
    try {
      const page = await getDirectInboxPage.execute(ownerUserId, null);
      if (!mountedRef.current || generation !== generationRef.current) return false;
      publish({ ownerUserId, status: 'ready', page, operation: 'idle', silent: false, error: null,
        refreshError: null, loadMoreError: null });
      loaded = true;
    } catch (error: unknown) {
      if (!mountedRef.current || generation !== generationRef.current) return false;
      publish({ ...previous, status: hasPage ? 'ready' : 'error', operation: 'idle', silent: false,
        error: hasPage ? null : normalizeError(error), refreshError: hasPage ? normalizeError(error) : null,
        loadMoreError: null });
    }
    if (trailingRefreshRef.current) {
      trailingRefreshRef.current = false;
      void load(true);
    }
    return loaded;
  }, [ownerUserId, publish]);

  const loadFirst = useCallback(() => load(false), [load]);

  const loadMore = useCallback(async (retry = false) => {
    const previous = stateRef.current;
    if (!mountedRef.current || previous.ownerUserId !== ownerUserId || previous.status !== 'ready' ||
        previous.operation !== 'idle' || previous.page.nextCursor === null ||
        (previous.loadMoreError !== null && !retry)) return;
    const generation = generationRef.current;
    publish({ ...previous, operation: 'loading-more', loadMoreError: null });
    try {
      const page = await getDirectInboxPage.execute(ownerUserId, previous.page.nextCursor);
      if (!mountedRef.current || generation !== generationRef.current) return;
      publish({ ...previous, page: { conversations: [...previous.page.conversations, ...page.conversations],
        nextCursor: page.nextCursor }, operation: 'idle', loadMoreError: null });
    } catch (error: unknown) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      publish({ ...previous, operation: 'idle', loadMoreError: normalizeError(error) });
    }
  }, [ownerUserId, publish]);

  useEffect(() => {
    mountedRef.current = true;
    trailingRefreshRef.current = false;
    const next = initial(ownerUserId);
    stateRef.current = next;
    setState(next);
    void loadFirst();
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      trailingRefreshRef.current = false;
      stateRef.current.operation = 'idle';
    };
  }, [ownerUserId, loadFirst]);

  // New activity for THIS owner (global inbox subscription): re-read the first page over
  // HTTP. Peer, preview, unread count and order all come from the read model, never
  // from the hint. A load in progress gets one trailing refresh; a page being appended
  // is superseded (its generation is bumped).
  useEffect(() => directInboxRealtimeSignal.subscribe(ownerUserId, () => {
    const current = stateRef.current;
    if (!mountedRef.current || current.ownerUserId !== ownerUserId) return;
    if (current.operation === 'initial' || current.operation === 'refreshing') {
      trailingRefreshRef.current = true;
      return;
    }
    void load(true);
  }), [ownerUserId, load]);

  return {
    state: state.ownerUserId === ownerUserId ? state : { ...state, ownerUserId, status: 'loading' as const, page: emptyPage },
    refresh: loadFirst,
    retry: loadFirst,
    onEndReached: useCallback(() => { void loadMore(); }, [loadMore]),
    retryLoadMore: useCallback(() => { void loadMore(true); }, [loadMore]),
  };
}
