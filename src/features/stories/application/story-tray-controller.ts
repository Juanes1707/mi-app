import type { GetStoryTrayPage } from '@/features/stories/application/story-use-cases';
import type { StoryTray, StoryTrayCursor } from '@/features/stories/domain/story';
import { StoriesError } from '@/features/stories/domain/stories-error';

export type StoryTrayState = {
  status: 'loading' | 'ready' | 'error';
  trays: StoryTray[];
  nextCursor: StoryTrayCursor | null;
  operation: 'idle' | 'initial' | 'refreshing' | 'loading-more';
  error: StoriesError | null;
  refreshError: StoriesError | null;
  loadMoreError: StoriesError | null;
};

const INITIAL: StoryTrayState = {
  status: 'loading', trays: [], nextCursor: null, operation: 'idle',
  error: null, refreshError: null, loadMoreError: null,
};

// The Home tray of ONE owner: server pages (keyset cursor kept as given), refresh of
// the first page coalesced, load-more guarded against duplicates. Disposed on owner
// switch/unmount: every late response is dropped by the generation check.
export class StoryTrayController {
  private state: StoryTrayState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private disposed = false;
  private firstPage: Promise<boolean> | null = null;

  constructor(private readonly ownerUserId: string, private readonly getPage: GetStoryTrayPage) {}

  getState = (): StoryTrayState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  // Loads (or refreshes) the first page. Concurrent calls share one request.
  refresh(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.firstPage !== null) return this.firstPage;
    const generation = ++this.generation;
    const previous = this.state;
    const hasPage = previous.status === 'ready';
    this.publish({
      ...previous, status: hasPage ? 'ready' : 'loading', operation: hasPage ? 'refreshing' : 'initial',
      error: null, refreshError: null, loadMoreError: null,
    });
    const load = (async () => {
      try {
        // The use case validates synchronously; await keeps every failure inside this promise.
        const page = await Promise.resolve().then(() => this.getPage.execute(this.ownerUserId, null));
        if (!this.isCurrent(generation)) return false;
        this.publish({
          status: 'ready', trays: dedupe([], page.trays), nextCursor: page.nextCursor, operation: 'idle',
          error: null, refreshError: null, loadMoreError: null,
        });
        return true;
      } catch (error: unknown) {
        if (!this.isCurrent(generation)) return false;
        const failure = asStoriesError(error);
        this.publish({
          ...previous, status: hasPage ? 'ready' : 'error', operation: 'idle',
          error: hasPage ? null : failure, refreshError: hasPage ? failure : null, loadMoreError: null,
        });
        return false;
      }
    })();
    this.firstPage = load;
    // Attached after the assignment, so even an instant settlement frees the slot.
    void load.finally(() => { if (this.firstPage === load) this.firstPage = null; });
    return load;
  }

  async loadMore(retry = false): Promise<void> {
    const previous = this.state;
    if (this.disposed || previous.status !== 'ready' || previous.operation !== 'idle' ||
        previous.nextCursor === null || (previous.loadMoreError !== null && !retry)) return;
    const generation = this.generation;
    this.publish({ ...previous, operation: 'loading-more', loadMoreError: null });
    try {
      const page = await Promise.resolve().then(() => this.getPage.execute(this.ownerUserId, previous.nextCursor));
      if (!this.isCurrent(generation)) return;
      const latest = this.state;
      this.publish({
        ...latest, trays: dedupe(latest.trays, page.trays), nextCursor: page.nextCursor,
        operation: 'idle', loadMoreError: null,
      });
    } catch (error: unknown) {
      if (!this.isCurrent(generation)) return;
      this.publish({ ...this.state, operation: 'idle', loadMoreError: asStoriesError(error) });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.firstPage = null;
    this.listeners.clear();
  }

  private isCurrent(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }

  private publish(next: StoryTrayState): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }
}

// An author whose newest Story expired between two pages can move below the cursor and
// come back on the next page: the first occurrence wins, nothing is shown twice.
function dedupe(current: StoryTray[], incoming: StoryTray[]): StoryTray[] {
  const seen = new Set(current.map((tray) => tray.author.id));
  const added = incoming.filter((tray) => {
    if (seen.has(tray.author.id)) return false;
    seen.add(tray.author.id);
    return true;
  });
  return added.length === 0 && current.length > 0 ? current : [...current, ...added];
}

function asStoriesError(error: unknown): StoriesError {
  return error instanceof StoriesError ? error : new StoriesError('unavailable');
}
