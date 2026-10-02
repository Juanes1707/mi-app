import type {
  AuthRepository,
  AuthStateErrorListener,
  AuthStateListener,
} from '@/features/auth/domain/repositories/auth-repository';

export class WatchAuthState {
  constructor(private readonly repository: AuthRepository) {}

  execute(listener: AuthStateListener, onError: AuthStateErrorListener): () => void {
    return this.repository.subscribeToAuthChanges(listener, onError);
  }
}
