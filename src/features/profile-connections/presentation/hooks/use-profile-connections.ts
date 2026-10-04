import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ProfileConnectionsController,
} from '@/features/profile-connections/application/profile-connections-controller';
import type { ProfileConnectionKind } from '@/features/profile-connections/domain/profile-connection';
import { getProfileConnectionsPage } from '@/features/profile-connections/profile-connections-container';

export function useProfileConnections(
  ownerUserId: string,
  targetUserId: string,
  kind: ProfileConnectionKind,
) {
  const controller = useMemo(() => new ProfileConnectionsController(
    { ownerUserId, targetUserId, kind }, getProfileConnectionsPage,
  ), [kind, ownerUserId, targetUserId]);
  const [state, setState] = useState(controller.state);

  useEffect(() => {
    setState(controller.state);
    const unsubscribe = controller.subscribe(setState);
    controller.start();
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);

  return {
    state: state.ownerUserId === ownerUserId && state.targetUserId === targetUserId &&
      state.kind === kind ? state : controller.state,
    refresh: useCallback(() => controller.refresh(), [controller]),
    retry: useCallback(() => controller.retry(), [controller]),
    onEndReached: useCallback(() => controller.onEndReached(), [controller]),
    retryLoadMore: useCallback(() => controller.retryLoadMore(), [controller]),
  };
}
