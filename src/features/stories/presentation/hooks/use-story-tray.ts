import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { StoryTrayController, type StoryTrayState } from '@/features/stories/application/story-tray-controller';
import type { StoryTray } from '@/features/stories/domain/story';
import { getStoryTrayPage, storySeenTracker } from '@/features/stories/stories-container';

const LOADING: StoryTrayState = {
  status: 'loading', trays: [], nextCursor: null, operation: 'idle',
  error: null, refreshError: null, loadMoreError: null,
};
const noSubscription = () => () => undefined;
const loadingState = () => LOADING;

// Home tray of the signed-in owner. A new owner gets a new controller: the previous
// one is disposed, so none of its late responses can reach the new owner's tray.
export function useStoryTray(ownerUserId: string | null) {
  const [slot, setSlot] = useState<{ owner: string; controller: StoryTrayController } | null>(null);
  // Never read another owner's controller, even in the render before the effect below.
  const controller = slot !== null && slot.owner === ownerUserId ? slot.controller : null;

  useEffect(() => {
    if (ownerUserId === null) { setSlot(null); return; }
    const created = new StoryTrayController(ownerUserId, getStoryTrayPage);
    setSlot({ owner: ownerUserId, controller: created });
    void created.refresh();
    void storySeenTracker.ensureLoaded(ownerUserId);
    return () => created.dispose();
  }, [ownerUserId]);

  const state = useSyncExternalStore(controller?.subscribe ?? noSubscription, controller?.getState ?? loadingState);
  // Rings re-evaluate whenever local seen state changes (e.g. back from the viewer).
  const seenVersion = useSyncExternalStore(storySeenTracker.subscribe, storySeenTracker.getVersion);

  const refresh = useCallback(() => { void controller?.refresh(); }, [controller]);
  const loadMore = useCallback(() => { void controller?.loadMore(); }, [controller]);
  const retryLoadMore = useCallback(() => { void controller?.loadMore(true); }, [controller]);
  // The version must be a real input of the callback: React Compiler infers
  // dependencies from what the closure uses and would drop a bare `void seenVersion`,
  // freezing the rings until the tray data itself changed (e.g. after a reload the
  // persisted "seen" state loaded but the rings stayed coloured).
  const isFullySeen = useCallback(
    (tray: StoryTray) => isTrayFullySeenAt(seenVersion, ownerUserId, tray),
    [ownerUserId, seenVersion],
  );

  return { state, refresh, loadMore, retryLoadMore, isFullySeen };
}

// `_version` ties a ring evaluation to the seen-state version it was computed for.
function isTrayFullySeenAt(_version: number, ownerUserId: string | null, tray: StoryTray): boolean {
  return ownerUserId !== null && storySeenTracker.isTrayFullySeen(ownerUserId, tray);
}
