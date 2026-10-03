import { useEffect } from 'react';

import { useAuth } from '@/features/auth/presentation/hooks/use-auth';
import { offlineSyncCoordinator } from '@/features/offline-sync/offline-sync-container';

// Mounted once below AuthProvider so owner and foreground events are observed even
// when the Feed route is absent.
export function OfflineSyncCoordinatorHost() {
  const { user } = useAuth();

  useEffect(() => {
    offlineSyncCoordinator.start();
    return () => offlineSyncCoordinator.stop();
  }, []);

  useEffect(() => {
    offlineSyncCoordinator.setOwnerUserId(user?.id ?? null);
  }, [user?.id]);

  return null;
}
