import { useEffect } from 'react';

import { useAuth } from '@/features/auth/presentation/hooks/use-auth';
import {
  offlineSyncBackgroundScheduler, offlineSyncCoordinator,
} from '@/features/offline-sync/offline-sync-container';

// Mounted once below AuthProvider so owner and foreground events are observed even
// when the Feed route is absent.
export function OfflineSyncCoordinatorHost() {
  const { user, isLoading } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    offlineSyncCoordinator.start();
    return () => offlineSyncCoordinator.stop();
  }, []);

  useEffect(() => {
    offlineSyncCoordinator.setOwnerUserId(userId);
  }, [userId]);

  // While someone is signed in, the OS may also drain the queue in background.
  // Nothing changes while the session is still being restored at launch.
  useEffect(() => {
    if (isLoading) return;
    void (userId !== null
      ? offlineSyncBackgroundScheduler.enable()
      : offlineSyncBackgroundScheduler.disable());
  }, [isLoading, userId]);

  return null;
}
