import { useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';

import { StoryPressArbiter } from '@/features/stories/application/story-playback-controller';

// A press longer than this pauses (hold) instead of navigating (tap).
export const STORY_HOLD_MS = 250;

type StoryGestureActions = {
  onPrevious: () => void;
  onNext: () => void;
  onHoldStart: () => void;
  onHoldEnd: () => void;
};

// Long press (pause while held) has priority over tap (left half: previous, right
// half: next): Exclusive lets the tap fire only after the long press has failed.
export function useStoryGestures(width: number, actions: StoryGestureActions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const widthRef = useRef(width);
  widthRef.current = width;

  return useMemo(() => {
    const arbiter = new StoryPressArbiter({
      onPrevious: () => actionsRef.current.onPrevious(),
      onNext: () => actionsRef.current.onNext(),
      onHoldStart: () => actionsRef.current.onHoldStart(),
      onHoldEnd: () => actionsRef.current.onHoldEnd(),
    });
    const hold = Gesture.LongPress()
      .minDuration(STORY_HOLD_MS)
      .maxDistance(48)
      .runOnJS(true)
      .onBegin(() => arbiter.pressBegan())
      .onStart(() => arbiter.holdStarted())
      .onFinalize(() => arbiter.holdFinished());
    const tap = Gesture.Tap()
      .maxDuration(STORY_HOLD_MS)
      .runOnJS(true)
      .onEnd((event, success) => {
        if (success) arbiter.tapped(event.x, widthRef.current);
      });
    return Gesture.Exclusive(hold, tap);
  }, []);
}
