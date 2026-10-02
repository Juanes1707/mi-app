import { createContext, useEffect, useState, type PropsWithChildren } from 'react';

import type { GetCurrentAuthUser } from '@/features/auth/application/use-cases/get-current-auth-user';
import type { WatchAuthState } from '@/features/auth/application/use-cases/watch-auth-state';
import type { AuthUser } from '@/features/auth/domain/entities/auth-user';

export type AuthState = {
  user: AuthUser | null;
  isLoading: boolean;
  error: Error | null;
};

type AuthProviderProps = PropsWithChildren<{
  getCurrentAuthUser: GetCurrentAuthUser;
  watchAuthState: WatchAuthState;
}>;

export const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({
  children,
  getCurrentAuthUser,
  watchAuthState,
}: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | undefined;

    const handleAuthUser = (user: AuthUser | null) => {
      if (isMounted) {
        setState({ user, isLoading: false, error: null });
      }
    };

    const handleAuthError = (error: Error) => {
      if (isMounted) {
        setState({ user: null, isLoading: false, error });
      }
    };

    const startWatching = () => {
      if (isMounted) {
        unsubscribe = watchAuthState.execute(handleAuthUser, handleAuthError);
      }
    };

    void getCurrentAuthUser
      .execute()
      .then((user) => {
        handleAuthUser(user);
        startWatching();
      })
      .catch((error: unknown) => {
        handleAuthError(normalizeError(error));
        startWatching();
      });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, [getCurrentAuthUser, watchAuthState]);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error('An unexpected error occurred while checking authentication.');
}
