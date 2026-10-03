import { AppState } from 'react-native';

// RAM is released on an OS memory warning (iOS) and when the app is backgrounded.
// Disk is never touched here: it is the level that survives memory pressure.
export function subscribeToMemoryPressure(onPressure: () => void): () => void {
  const subscriptions = [
    AppState.addEventListener('memoryWarning', () => onPressure()),
    AppState.addEventListener('change', (state) => {
      if (state === 'background') onPressure();
    }),
  ];
  return () => {
    for (const subscription of subscriptions) subscription.remove();
  };
}
