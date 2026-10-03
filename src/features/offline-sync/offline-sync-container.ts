import NetInfo from '@react-native-community/netinfo';
import { openDatabaseAsync } from 'expo-sqlite';
import { AppState } from 'react-native';

import { authProviderDependencies } from '@/features/auth/auth-container';
import { OfflineSyncCoordinator } from '@/features/offline-sync/application/offline-sync-coordinator';
import { OfflineMutationProcessor } from '@/features/offline-sync/application/offline-mutation-processor';
import { OfflineSyncOrchestrator } from '@/features/offline-sync/application/offline-sync-orchestrator';
import { OwnerReconciliationSignal } from '@/features/offline-sync/application/owner-reconciliation-signal';
import {
  GetPendingPostLikeProjection, QueueSetPostLike,
} from '@/features/offline-sync/application/post-like-use-cases';
import { BackendPostLikeRemoteGateway } from '@/features/offline-sync/data/backend-post-like-remote-gateway';
import type { OfflineMutationQueue } from '@/features/offline-sync/domain/offline-mutation-queue';
import {
  OFFLINE_MUTATIONS_DATABASE_NAME, prepareOfflineMutationDatabase,
} from '@/features/offline-sync/infrastructure/offline-mutation-database';
import { SQLiteOfflineMutationQueue } from '@/features/offline-sync/infrastructure/sqlite-offline-mutation-queue';
import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

// One shared queue for the whole app. Nothing is opened at import time: the first
// queue operation opens the database (expo-sqlite's default directory, which is
// persistent app storage — filesDir/SQLite on Android, not the cache) and migrates it.
export const offlineMutationQueue: OfflineMutationQueue = new SQLiteOfflineMutationQueue(
  async () => prepareOfflineMutationDatabase(await openDatabaseAsync(OFFLINE_MUTATIONS_DATABASE_NAME)),
);

// One shared processor; only the orchestrator requests production drains.
const offlineMutationProcessor = new OfflineMutationProcessor(
  offlineMutationQueue,
  {
    getCurrentUserId: async () =>
      (await authProviderDependencies.getCurrentAuthUser.execute())?.id ?? null,
  },
  new BackendPostLikeRemoteGateway(authenticatedBackendApiClient),
);

export const offlineSyncReconciliation = new OwnerReconciliationSignal();
export const offlineSyncOrchestrator = new OfflineSyncOrchestrator(
  offlineMutationProcessor,
  offlineSyncReconciliation,
);
export const offlineSyncCoordinator = new OfflineSyncCoordinator(
  {
    fetch: () => NetInfo.fetch(),
    subscribe: (listener) => NetInfo.addEventListener(listener),
  },
  {
    getCurrentState: () => AppState.currentState,
    subscribe: (listener) => {
      const subscription = AppState.addEventListener('change', listener);
      return () => subscription.remove();
    },
  },
  offlineSyncOrchestrator,
);

export const queueSetPostLike = new QueueSetPostLike(offlineMutationQueue);
export const getPendingPostLikeProjection = new GetPendingPostLikeProjection(offlineMutationQueue);
