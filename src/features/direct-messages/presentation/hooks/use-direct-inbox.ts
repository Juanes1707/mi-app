import { useCallback, useEffect, useRef, useState } from 'react';

import { getDirectInboxPage } from '@/features/direct-messages/direct-messages-container';
import type { DirectInboxPage } from '@/features/direct-messages/domain/direct-message';
import { DirectMessagesError } from '@/features/direct-messages/domain/direct-messages-error';

type InboxState = {
  ownerUserId: string;
  status: 'loading' | 'ready' | 'error';
  page: DirectInboxPage;
  operation: 'idle' | 'initial' | 'refreshing' | 'loading-more';
  error: DirectMessagesError | null;
  refreshError: DirectMessagesError | null;
  loadMoreError: DirectMessagesError | null;
};
const emptyPage: DirectInboxPage = { conversations: [], nextCursor: null };
const normalizeError = (value: unknown) => value instanceof DirectMessagesError
  ? value : new DirectMessagesError('unavailable');

export function useDirectInbox(ownerUserId: string) {
  const [state, setState] = useState<InboxState>(() => ({ ownerUserId, status: 'loading', page: emptyPage,
    operation: 'idle', error: null, refreshError: null, loadMoreError: null }));
  const stateRef = useRef(state);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const publish = useCallback((next: InboxState) => { stateRef.current = next; setState(next); }, []);

  const loadFirst = useCallback(async () => {
    if (!mountedRef.current || stateRef.current.ownerUserId !== ownerUserId) return false;
    const previous = stateRef.current;
    if (previous.operation === 'initial' || previous.operation === 'refreshing') return false;
    const generation = ++generationRef.current;
    const hasPage = previous.status === 'ready';
    publish({ ...previous, status: hasPage ? 'ready' : 'loading',
      operation: hasPage ? 'refreshing' : 'initial', error: null, refreshError: null, loadMoreError: null });
    try {
      const page = await getDirectInboxPage.execute(ownerUserId, null);
      if (!mountedRef.current || generation !== generationRef.current) return false;
      publish({ ownerUserId, status: 'ready', page, operation: 'idle', error: null,
        refreshError: null, loadMoreError: null });
      return true;
    } catch (error: unknown) {
      if (!mountedRef.current || generation !== generationRef.current) return false;
      publish({ ...previous, status: hasPage ? 'ready' : 'error', operation: 'idle',
        error: hasPage ? null : normalizeError(error), refreshError: hasPage ? normalizeError(error) : null,
        loadMoreError: null });
      return false;
    }
  }, [ownerUserId, publish]);

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
    const next: InboxState = { ownerUserId, status: 'loading', page: emptyPage, operation: 'idle',
      error: null, refreshError: null, loadMoreError: null };
    stateRef.current = next;
    setState(next);
    void loadFirst();
    return () => { mountedRef.current = false; generationRef.current += 1; stateRef.current.operation = 'idle'; };
  }, [ownerUserId, loadFirst]);

  return {
    state: state.ownerUserId === ownerUserId ? state : { ...state, ownerUserId, status: 'loading' as const, page: emptyPage },
    refresh: loadFirst,
    retry: loadFirst,
    onEndReached: useCallback(() => { void loadMore(); }, [loadMore]),
    retryLoadMore: useCallback(() => { void loadMore(true); }, [loadMore]),
  };
}
