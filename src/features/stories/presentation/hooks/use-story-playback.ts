import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { cancelAnimation, Easing, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import {
  StoryPlaybackController, type StoryProgressAnimator,
} from '@/features/stories/application/story-playback-controller';

// Reanimated draws the progress on the UI thread (no JS interval); the controller
// decides when it runs. The timing callback hops back to JS only to advance.
function createAnimator(progress: SharedValue<number>): StoryProgressAnimator {
  return {
    run(from, durationMs, onComplete) {
      cancelAnimation(progress);
      progress.value = from;
      progress.value = withTiming(1, { duration: durationMs, easing: Easing.linear }, (finished) => {
        'worklet';
        if (finished) scheduleOnRN(onComplete);
      });
    },
    hold(at) {
      cancelAnimation(progress);
      progress.value = at;
    },
  };
}

// Autoplay for the viewer: runs only while the Story is displayed, the screen is
// focused, the app is active and the user is not holding. Back from background, the
// viewer revalidates FIRST and only then may playback continue (remaining time).
export function useStoryPlayback(
  playKey: string | null,
  ready: boolean,
  onFinished: () => void,
  onForeground: () => Promise<void>,
) {
  const progress = useSharedValue(0);
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;
  const onForegroundRef = useRef(onForeground);
  onForegroundRef.current = onForeground;
  const [playback, setPlayback] = useState<StoryPlaybackController | null>(null);

  useEffect(() => {
    const created = new StoryPlaybackController(createAnimator(progress), () => onFinishedRef.current());
    setPlayback(created);
    return () => created.dispose();
  }, [progress]);

  useEffect(() => {
    playback?.setStory(playKey, ready);
  }, [playback, playKey, ready]);

  useFocusEffect(useCallback(() => {
    playback?.resume('blur');
    return () => playback?.pause('blur');
  }, [playback]));

  useEffect(() => {
    if (playback === null) return;
    if (AppState.currentState !== 'active') playback.pause('background');
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        playback.pause('background');
        return;
      }
      void onForegroundRef.current().catch(() => undefined).finally(() => playback.resume('background'));
    });
    return () => subscription.remove();
  }, [playback]);

  const holdStart = useCallback(() => playback?.pause('hold'), [playback]);
  const holdEnd = useCallback(() => playback?.resume('hold'), [playback]);
  return { progress, holdStart, holdEnd };
}
