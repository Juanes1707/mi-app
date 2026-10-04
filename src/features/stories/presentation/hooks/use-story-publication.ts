import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  StoryPublicationController, type StoryPublicationState,
} from '@/features/stories/application/story-publication-controller';
import type { PublishedStory } from '@/features/stories/domain/story';
import { storyPublicationDependencies } from '@/features/stories/stories-container';

const IDLE: StoryPublicationState = { phase: 'idle', error: null, canRetry: false };
const noSubscription = () => () => undefined;
const idleState = () => IDLE;

// "+" on the Home tray: pick one image and publish it as a Story of the owner.
export function useStoryPublication(ownerUserId: string | null, onPublished: (story: PublishedStory) => void) {
  const onPublishedRef = useRef(onPublished);
  onPublishedRef.current = onPublished;
  const [slot, setSlot] = useState<{ owner: string; controller: StoryPublicationController } | null>(null);
  const controller = slot !== null && slot.owner === ownerUserId ? slot.controller : null;

  useEffect(() => {
    if (ownerUserId === null) { setSlot(null); return; }
    const created = new StoryPublicationController(
      ownerUserId, storyPublicationDependencies, (story) => onPublishedRef.current(story),
    );
    setSlot({ owner: ownerUserId, controller: created });
    return () => created.dispose();
  }, [ownerUserId]);

  const state = useSyncExternalStore(controller?.subscribe ?? noSubscription, controller?.getState ?? idleState);
  const pickAndPublish = useCallback(() => { void controller?.pickAndPublish(); }, [controller]);
  const retry = useCallback(() => { void controller?.retry(); }, [controller]);
  const discard = useCallback(() => { controller?.discard(); }, [controller]);
  const busy = state.phase === 'picking' || state.phase === 'preparing' ||
    state.phase === 'uploading' || state.phase === 'publishing';

  return { state, busy, pickAndPublish, retry, discard };
}
