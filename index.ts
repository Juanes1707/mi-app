// Loads the offline sync container (which defines the background sync task) before
// Expo Router starts: when the OS wakes the app only to run that task, no route,
// not even the root layout, is loaded. Expo Router must be imported last.
import './src/features/offline-sync/offline-sync-container';
import 'expo-router/entry';
