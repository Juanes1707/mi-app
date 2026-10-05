import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import type {
  BackgroundSyncOutcome, OfflineSyncBackgroundScheduler,
} from '@/features/offline-sync/application/offline-sync-background';
import { SerialExecutor } from './serial-executor';

export const OFFLINE_SYNC_BACKGROUND_TASK = 'offline-mutation-sync';
// Android WorkManager's minimum period (minutes); the OS also waits for network and
// enough battery. iOS treats it as a hint and picks the moment itself.
const MINIMUM_INTERVAL_MINUTES = 15;

// TaskManager needs the definition at module (global) scope, before any component
// mounts, so a run started by the OS finds it even when no screen is rendered.
export function defineOfflineSyncBackgroundTask(run: () => Promise<BackgroundSyncOutcome>): void {
  try {
    if (TaskManager.isTaskDefined(OFFLINE_SYNC_BACKGROUND_TASK)) return;
    TaskManager.defineTask(OFFLINE_SYNC_BACKGROUND_TASK, async () => (
      (await run()) === 'success'
        ? BackgroundTask.BackgroundTaskResult.Success
        : BackgroundTask.BackgroundTaskResult.Failed
    ));
  } catch {
    // Without the OS task, foreground triggers and retries still sync the queue.
  }
}

// Calls run one at a time, so a quick sign-out/sign-in never interleaves
// register and unregister.
export class ExpoOfflineSyncBackgroundScheduler implements OfflineSyncBackgroundScheduler {
  private readonly executor = new SerialExecutor();

  enable(): Promise<void> {
    return this.executor.run(async () => {
      try {
        const status = await BackgroundTask.getStatusAsync();
        if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
        // Registering again would restart the OS schedule on every launch.
        if (await TaskManager.isTaskRegisteredAsync(OFFLINE_SYNC_BACKGROUND_TASK)) return;
        await BackgroundTask.registerTaskAsync(OFFLINE_SYNC_BACKGROUND_TASK, {
          minimumInterval: MINIMUM_INTERVAL_MINUTES,
        });
      } catch {
        // Best effort: see defineOfflineSyncBackgroundTask.
      }
    });
  }

  disable(): Promise<void> {
    return this.executor.run(async () => {
      try {
        if (!(await TaskManager.isTaskRegisteredAsync(OFFLINE_SYNC_BACKGROUND_TASK))) return;
        await BackgroundTask.unregisterTaskAsync(OFFLINE_SYNC_BACKGROUND_TASK);
      } catch {
        // Best effort.
      }
    });
  }
}
