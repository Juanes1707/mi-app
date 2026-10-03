import { AppState } from 'react-native';

// Android (target platform): React Native's AppStateModule only emits app-state and
// focus changes, so going to background is the one memory signal available to JS
// without a custom native module (no onTrimMemory bridge exists).
// iOS (secondary): `memoryWarning` is also honoured.
// Disk is never touched here: it is the level that survives memory pressure.
export function subscribeToMemoryPressure(onPressure: () => void): () => void {
  const subscriptions = [
    AppState.addEventListener('change', (state) => {
      if (state === 'background') onPressure();
    }),
    AppState.addEventListener('memoryWarning', () => onPressure()),
  ];
  return () => {
    for (const subscription of subscriptions) subscription.remove();
  };
}
