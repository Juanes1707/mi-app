import { openDatabaseAsync } from 'expo-sqlite';

import type { OfflineMutationQueue } from '@/features/offline-sync/domain/offline-mutation-queue';
import {
  OFFLINE_MUTATIONS_DATABASE_NAME, prepareOfflineMutationDatabase,
} from '@/features/offline-sync/infrastructure/offline-mutation-database';
import { SQLiteOfflineMutationQueue } from '@/features/offline-sync/infrastructure/sqlite-offline-mutation-queue';

// One shared queue for the whole app. Nothing is opened at import time: the first
// queue operation opens the database (expo-sqlite's default directory, which is
// persistent app storage — filesDir/SQLite on Android, not the cache) and migrates it.
export const offlineMutationQueue: OfflineMutationQueue = new SQLiteOfflineMutationQueue(
  async () => prepareOfflineMutationDatabase(await openDatabaseAsync(OFFLINE_MUTATIONS_DATABASE_NAME)),
);
