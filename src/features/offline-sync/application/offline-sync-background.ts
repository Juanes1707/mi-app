import type { OfflineSyncTrigger } from '@/features/offline-sync/application/offline-sync-orchestrator';

export interface BackgroundDrainRequester {
  requestDrain(trigger: OfflineSyncTrigger): Promise<void>;
}

// Lets the operating system run the queue while the app is in background (Android
// WorkManager / iOS BGTaskScheduler, only when the network is available). Enabled
// while someone is signed in; best effort, so failures never reach the UI.
export interface OfflineSyncBackgroundScheduler {
  enable(): Promise<void>;
  disable(): Promise<void>;
}

export type BackgroundSyncOutcome = 'success' | 'failed';

// Body of the OS task. It goes through the same orchestrator as every foreground
// trigger: one processor, one global FIFO, at most one request in flight, and a run
// already active in this process is joined instead of duplicated.
export async function runBackgroundOfflineSync(
  orchestrator: BackgroundDrainRequester,
): Promise<BackgroundSyncOutcome> {
  try {
    await orchestrator.requestDrain('background-task');
    return 'success';
  } catch {
    return 'failed';
  }
}
