import type { GetProfileConnectionsPage } from '@/features/profile-connections/application/get-profile-connections-page';
import type {
  ProfileConnectionKind, ProfileConnectionsPage,
} from '@/features/profile-connections/domain/profile-connection';
import { ProfileConnectionsError } from '@/features/profile-connections/domain/profile-connections-error';

export type ProfileConnectionsState = {
  ownerUserId: string;
  targetUserId: string;
  kind: ProfileConnectionKind;
  status: 'loading' | 'ready' | 'error';
  page: ProfileConnectionsPage;
  operation: 'idle' | 'initial' | 'refreshing' | 'loading-more';
  error: ProfileConnectionsError | null;
  refreshError: ProfileConnectionsError | null;
  loadMoreError: ProfileConnectionsError | null;
};

const EMPTY_PAGE: ProfileConnectionsPage = { connections: [], nextCursor: null };
const normalizeError = (error: unknown) => error instanceof ProfileConnectionsError
  ? error
  : new ProfileConnectionsError('unavailable');
const mustHidePage = (error: ProfileConnectionsError) =>
  error.code === 'profile-not-found' || error.code === 'profile-not-ready' ||
  error.code === 'authentication-required' || error.code === 'owner-session-mismatch';

export class ProfileConnectionsController {
  private current: ProfileConnectionsState;
  private active = false;
  private generation = 0;
  private readonly listeners = new Set<(state: ProfileConnectionsState) => void>();

  constructor(
    private readonly input: {
      ownerUserId: string;
      targetUserId: string;
      kind: ProfileConnectionKind;
    },
    private readonly getPage: Pick<GetProfileConnectionsPage, 'execute'>,
  ) {
    this.current = this.initialState();
  }

  get state(): ProfileConnectionsState { return this.current; }

  subscribe(listener: (state: ProfileConnectionsState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.publish(this.initialState());
    void this.loadFirst();
  }

  dispose(): void {
    this.active = false;
    this.generation += 1;
    this.current = { ...this.current, operation: 'idle' };
    this.listeners.clear();
  }

  refresh(): Promise<boolean> { return this.loadFirst(); }
  retry(): Promise<boolean> { return this.loadFirst(); }
  onEndReached(): void { void this.loadMore(false); }
  retryLoadMore(): void { void this.loadMore(true); }

  private async loadFirst(): Promise<boolean> {
    if (!this.active || this.current.operation === 'initial' ||
        this.current.operation === 'refreshing') return false;
    const previous = this.current;
    const hasPage = previous.status === 'ready';
    const generation = ++this.generation;
    this.publish({
      ...previous,
      status: hasPage ? 'ready' : 'loading',
      operation: hasPage ? 'refreshing' : 'initial',
      error: null,
      refreshError: null,
      loadMoreError: null,
    });
    try {
      const page = await this.getPage.execute(
        this.input.ownerUserId, this.input.targetUserId, this.input.kind, null,
      );
      if (!this.active || generation !== this.generation) return false;
      this.publish({ ...this.identity(), status: 'ready', page, operation: 'idle',
        error: null, refreshError: null, loadMoreError: null });
      return true;
    } catch (error: unknown) {
      if (!this.active || generation !== this.generation) return false;
      const failure = normalizeError(error);
      if (hasPage && !mustHidePage(failure)) {
        this.publish({ ...previous, operation: 'idle', error: null,
          refreshError: failure, loadMoreError: null });
      } else {
        this.publish({ ...this.identity(), status: 'error', page: EMPTY_PAGE, operation: 'idle',
          error: failure, refreshError: null, loadMoreError: null });
      }
      return false;
    }
  }

  private async loadMore(retry: boolean): Promise<void> {
    const previous = this.current;
    if (!this.active || previous.status !== 'ready' || previous.operation !== 'idle' ||
        previous.page.nextCursor === null || (previous.loadMoreError !== null && !retry)) return;
    const generation = this.generation;
    this.publish({ ...previous, operation: 'loading-more', loadMoreError: null });
    try {
      const page = await this.getPage.execute(
        this.input.ownerUserId, this.input.targetUserId, this.input.kind,
        previous.page.nextCursor,
      );
      if (!this.active || generation !== this.generation) return;
      const known = new Set(previous.page.connections.map((connection) => connection.id));
      if (page.connections.some((connection) => known.has(connection.id))) {
        throw new ProfileConnectionsError('invalid-response');
      }
      this.publish({ ...previous, page: {
        connections: [...previous.page.connections, ...page.connections],
        nextCursor: page.nextCursor,
      }, operation: 'idle', loadMoreError: null });
    } catch (error: unknown) {
      if (!this.active || generation !== this.generation) return;
      const failure = normalizeError(error);
      if (mustHidePage(failure)) {
        this.publish({ ...this.identity(), status: 'error', page: EMPTY_PAGE, operation: 'idle',
          error: failure, refreshError: null, loadMoreError: null });
      } else {
        this.publish({ ...previous, operation: 'idle', loadMoreError: failure });
      }
    }
  }

  private publish(state: ProfileConnectionsState): void {
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }

  private identity() {
    return {
      ownerUserId: this.input.ownerUserId,
      targetUserId: this.input.targetUserId,
      kind: this.input.kind,
    };
  }

  private initialState(): ProfileConnectionsState {
    return { ...this.identity(), status: 'loading', page: EMPTY_PAGE, operation: 'idle',
      error: null, refreshError: null, loadMoreError: null };
  }
}
