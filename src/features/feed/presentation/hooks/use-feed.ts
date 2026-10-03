import { useCallback, useEffect, useRef, useState } from 'react';

import { FeedError } from '@/features/feed/domain/errors/feed-error';
import type { FeedPage } from '@/features/feed/domain/models/feed-page';
import { getFeedPage } from '@/features/feed/feed-container';

type FeedState = {
  status: 'initial-loading' | 'initial-error' | 'ready';
  page: FeedPage;
  operation: 'idle' | 'initial' | 'refreshing' | 'loading-more';
  error: FeedError | null;
  refreshError: FeedError | null;
  loadMoreError: FeedError | null;
};

const initialState: FeedState = {
  status: 'initial-loading',
  page: { posts: [], nextCursor: null },
  operation: 'idle',
  error: null,
  refreshError: null,
  loadMoreError: null,
};

function toFeedError(error: unknown): FeedError {
  return error instanceof FeedError ? error : new FeedError('unavailable');
}

export function useFeed() {
  const [state, setState] = useState<FeedState>(initialState);
  const stateRef = useRef(state);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const firstPageLoadRef = useRef<Promise<boolean> | null>(null);

  // Update the guard synchronously, before React's next render.
  const publish = useCallback((next: FeedState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  // Resolves true when this call published a fresh first page.
  const loadFirstPage = useCallback((): Promise<boolean> => {
    if (!mountedRef.current) return Promise.resolve(false);
    const previous = stateRef.current;
    if (previous.operation === 'initial' || previous.operation === 'refreshing') {
      return Promise.resolve(false);
    }

    const generation = ++generationRef.current;
    const hasPage = previous.status === 'ready';
    publish({
      ...previous,
      status: hasPage ? 'ready' : 'initial-loading',
      operation: hasPage ? 'refreshing' : 'initial',
      error: null,
      refreshError: null,
      loadMoreError: null,
    });

    const load = (async (): Promise<boolean> => {
      try {
        const page = await getFeedPage.execute(null);
        if (!mountedRef.current || generation !== generationRef.current) return false;
        publish({ status: 'ready', page, operation: 'idle', error: null,
          refreshError: null, loadMoreError: null });
        return true;
      } catch (error: unknown) {
        if (!mountedRef.current || generation !== generationRef.current) return false;
        publish({
          ...previous,
          status: hasPage ? 'ready' : 'initial-error',
          operation: 'idle',
          error: hasPage ? null : toFeedError(error),
          refreshError: hasPage ? toFeedError(error) : null,
          loadMoreError: null,
        });
        return false;
      }
    })();
    firstPageLoadRef.current = load;
    void load.finally(() => {
      if (firstPageLoadRef.current === load) firstPageLoadRef.current = null;
    });
    return load;
  }, [publish]);

  // For callers that just changed server state: the page must come from a request
  // started AFTER the change, so any load already in flight is awaited first.
  const refreshAfterChange = useCallback(async (): Promise<boolean> => {
    while (firstPageLoadRef.current !== null) await firstPageLoadRef.current;
    return loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async (retry = false) => {
    const previous = stateRef.current;
    if (!mountedRef.current || previous.status !== 'ready' ||
      previous.operation !== 'idle' || previous.page.nextCursor === null ||
      (previous.loadMoreError !== null && !retry)) return;

    const generation = generationRef.current;
    publish({ ...previous, operation: 'loading-more', loadMoreError: null });
    try {
      const page = await getFeedPage.execute(previous.page.nextCursor);
      if (!mountedRef.current || generation !== generationRef.current) return;
      publish({
        ...previous,
        page: { posts: [...previous.page.posts, ...page.posts], nextCursor: page.nextCursor },
        operation: 'idle',
        loadMoreError: null,
      });
    } catch (error: unknown) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      publish({ ...previous, operation: 'idle', loadMoreError: toFeedError(error) });
    }
  }, [publish]);

  useEffect(() => {
    mountedRef.current = true;
    void loadFirstPage();
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      // Allow a fresh initial request during React's development effect replay.
      stateRef.current = { ...stateRef.current, operation: 'idle' };
    };
  }, [loadFirstPage]);

  const onEndReached = useCallback(() => { void loadMore(); }, [loadMore]);
  const retryLoadMore = useCallback(() => { void loadMore(true); }, [loadMore]);
  return {
    state, refresh: loadFirstPage, refreshAfterChange, retryInitial: loadFirstPage, onEndReached, retryLoadMore,
  };
}
