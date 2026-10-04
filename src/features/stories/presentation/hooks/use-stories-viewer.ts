import type { ImageRef } from 'expo-image';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  StoriesViewerController, type StoriesViewerState,
} from '@/features/stories/application/stories-viewer-controller';
import { storyMediaCacheKey } from '@/features/stories/data/story-media-authorizer';
import type { Story } from '@/features/stories/domain/story';
import {
  getStoriesPage, getStoryTrayPage, storyImageSourceFor, storySeenTracker,
} from '@/features/stories/stories-container';

const LOADING: StoriesViewerState<ImageRef> = {
  status: 'loading', author: null, stories: [], index: 0, story: null, media: { status: 'none' },
  displayedStoryId: null, playKey: null,
};
const noSubscription = () => () => undefined;
const loadingState = () => LOADING;
const mediaKey = (story: Story) => storyMediaCacheKey(story.imagePath);

// One viewer session per (owner, entry author). Only the author id travels in the
// route; every Story, image and neighbor is loaded here through the use cases.
export function useStoriesViewer(ownerUserId: string, authorId: string, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const sessionKey = `${ownerUserId}|${authorId}`;
  const [slot, setSlot] = useState<{ key: string; controller: StoriesViewerController<ImageRef> } | null>(null);
  const controller = slot !== null && slot.key === sessionKey ? slot.controller : null;

  useEffect(() => {
    const created = new StoriesViewerController<ImageRef>(ownerUserId, authorId, {
      getTrayPage: getStoryTrayPage,
      getStoriesPage,
      seen: storySeenTracker,
      images: storyImageSourceFor(ownerUserId),
      mediaKey,
      onClose: () => onCloseRef.current(),
    });
    setSlot({ key: `${ownerUserId}|${authorId}`, controller: created });
    void created.open();
    // Unmount / other owner / other author: cancels image leases, drops late responses.
    return () => created.dispose();
  }, [ownerUserId, authorId]);

  const state = useSyncExternalStore(controller?.subscribe ?? noSubscription, controller?.getState ?? loadingState);
  return { state, controller };
}
