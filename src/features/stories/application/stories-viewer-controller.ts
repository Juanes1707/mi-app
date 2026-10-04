import type {
  PostImageOutcome, PostImageRequest, PostImageSource,
} from '@/features/post-media/application/post-image-request';
import type { GetStoriesPage, GetStoryTrayPage } from '@/features/stories/application/story-use-cases';
import type { StorySeenTracker } from '@/features/stories/application/story-seen-tracker';
import type { StoriesCursor, Story, StoryAuthor, StoryTrayCursor } from '@/features/stories/domain/story';
import { StoriesError } from '@/features/stories/domain/stories-error';
import { normalizeStoryUuid } from '@/features/stories/domain/story-values';

export type ViewerMedia<TImage> =
  | { status: 'none' }
  | { status: 'loading'; storyId: string }
  | { status: 'loaded'; storyId: string; image: TImage }
  | { status: 'failed'; storyId: string };

export type StoriesViewerState<TImage> = {
  status: 'invalid' | 'loading' | 'ready' | 'unavailable' | 'error' | 'closed';
  author: StoryAuthor | null;
  // The current author's active Stories loaded so far (one progress segment each).
  stories: readonly Story[];
  index: number;
  story: Story | null;
  media: ViewerMedia<TImage>;
  // The current Story is really on screen (image decoded AND displayed).
  displayedStoryId: string | null;
  // Changes when a Story is (re)entered from its beginning; stays for a revalidation.
  playKey: string | null;
};

export type StoriesViewerDependencies<TImage> = {
  getTrayPage: Pick<GetStoryTrayPage, 'execute'>;
  getStoriesPage: Pick<GetStoriesPage, 'execute'>;
  seen: Pick<StorySeenTracker, 'ensureLoaded' | 'isStorySeen' | 'markSeen' | 'completeAuthor'>;
  images: PostImageSource<TImage>;
  mediaKey: (story: Story) => string;
  onClose: () => void;
};

type AuthorStories = {
  stories: Story[];
  nextCursor: StoriesCursor | null;
  status: 'unloaded' | 'loaded' | 'not-found' | 'error';
  loading: Promise<void> | null;
  generation: number;
};

type Lease<TImage> = { storyId: string; request: PostImageRequest<TImage> };
type EnterOutcome = 'entered' | 'empty' | 'not-found' | 'error' | 'stale';

// Bounded scans: a cursor that would not advance can never spin forever.
const MAX_PAGES_PER_SCAN = 50;

const EMPTY_STATE = {
  author: null, stories: [], index: 0, story: null, media: { status: 'none' } as const,
  displayedStoryId: null, playKey: null,
};

// Fullscreen viewer data/navigation for ONE owner and ONE entry author. Order of
// authors is the Home tray order (self first, then follows) discovered by paging the
// tray until the entry author is found; an author outside the tray is viewed alone.
// Every async continuation checks a navigation token, so a late page or image of a
// previous Story/author can never change, mark or play the current one.
export class StoriesViewerController<TImage> {
  private state: StoriesViewerState<TImage>;
  private readonly listeners = new Set<() => void>();
  private readonly authors = new Map<string, AuthorStories>();
  private order: StoryAuthor[] = [];
  private inTray = false;
  private trayCursor: StoryTrayCursor | null = null;
  private trayLoading: Promise<void> | null = null;
  private currentAuthorId: string | null = null;
  private index = 0;
  private nav = 0;
  private mediaToken = 0;
  private showSeq = 0;
  private current: Lease<TImage> | null = null;
  private prefetch: Lease<TImage> | null = null;
  private media: ViewerMedia<TImage> = { status: 'none' };
  private displayedStoryId: string | null = null;
  private disposed = false;
  private readonly initialAuthorId: string | null;

  constructor(
    private readonly ownerUserId: string,
    authorId: string | null,
    private readonly deps: StoriesViewerDependencies<TImage>,
  ) {
    this.initialAuthorId = normalizeStoryUuid(authorId);
    this.state = { status: this.initialAuthorId === null ? 'invalid' : 'loading', ...EMPTY_STATE };
  }

  getState = (): StoriesViewerState<TImage> => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  // Invalid author: nothing is requested at all.
  async open(): Promise<void> {
    const authorId = this.initialAuthorId;
    if (authorId === null || this.disposed) return;
    const nav = ++this.nav;
    this.setStatus('loading');
    await this.deps.seen.ensureLoaded(this.ownerUserId);
    if (!this.isNav(nav)) return;
    this.trayLoading = this.locateInTray(authorId);
    const outcome = await this.enter(authorId, 'first-unseen', nav);
    if (outcome === 'entered' || outcome === 'stale') return;
    if (outcome === 'not-found') { this.setStatus('unavailable'); return; }
    if (outcome === 'error') { this.setStatus('error'); return; }
    // No active Story left for the entry author: continue with the next one, if any.
    await this.trayLoading;
    if (!this.isNav(nav)) return;
    if (this.inTray) {
      this.currentAuthorId = authorId;
      await this.nextAuthor(nav, 'unavailable');
    } else {
      this.setStatus('unavailable');
    }
  }

  // Opening failed on the network: try again from scratch.
  retryOpen(): void {
    if (this.state.status !== 'error' || this.disposed) return;
    this.authors.clear();
    this.order = [];
    this.inTray = false;
    this.trayCursor = null;
    void this.open();
  }

  // The image of the current Story is visible: mark it seen, warm the next one.
  mediaDisplayed(storyId: string): void {
    const story = this.state.story;
    if (this.disposed || story === null || story.id !== storyId || this.media.status !== 'loaded' ||
        this.media.storyId !== storyId || this.displayedStoryId === storyId) return;
    this.displayedStoryId = storyId;
    this.deps.seen.markSeen(this.ownerUserId, story);
    this.completeIfAllSeen(story.author.id);
    this.prefetchNext();
    this.publish();
  }

  retryMedia(): void {
    const story = this.state.story;
    if (this.disposed || story === null || this.media.status !== 'failed') return;
    this.acquire(story);
    this.publish();
  }

  async next(): Promise<void> {
    const authorId = this.currentAuthorId;
    if (this.disposed || this.state.status !== 'ready' || authorId === null) return;
    const nav = ++this.nav;
    const entry = this.entry(authorId);
    if (this.index + 1 < entry.stories.length) { this.show(authorId, this.index + 1); return; }
    if (entry.nextCursor !== null) {
      await this.loadNextPage(authorId);
      if (!this.isNav(nav)) return;
      if (this.index + 1 < entry.stories.length) { this.show(authorId, this.index + 1); return; }
    }
    await this.nextAuthor(nav, 'close');
  }

  async previous(): Promise<void> {
    const authorId = this.currentAuthorId;
    if (this.disposed || this.state.status !== 'ready' || authorId === null) return;
    const nav = ++this.nav;
    if (this.index > 0) { this.show(authorId, this.index - 1); return; }
    await this.trayLoading;
    if (!this.isNav(nav)) return;
    for (let position = this.position(authorId) - 1; position >= 0; position -= 1) {
      const candidate = this.order[position];
      if (candidate === undefined) break;
      const outcome = await this.enter(candidate.id, 'last', nav);
      if (outcome === 'entered' || outcome === 'stale') return;
    }
    // First Story of the first author: stay, and replay it from the start.
    this.show(authorId, this.index);
  }

  // Back from background: the backend re-decides what is still active and visible.
  async revalidate(): Promise<void> {
    const authorId = this.currentAuthorId;
    const story = this.state.story;
    if (this.disposed || this.state.status !== 'ready' || authorId === null || story === null) return;
    const nav = this.nav;
    let stories: Story[] = [];
    let cursor: StoriesCursor | null = null;
    try {
      for (let pages = 0; pages < MAX_PAGES_PER_SCAN; pages += 1) {
        const page = await Promise.resolve().then(() =>
          this.deps.getStoriesPage.execute(this.ownerUserId, authorId, cursor));
        if (!this.isNav(nav)) return;
        stories = appendNew(stories, page.stories);
        cursor = page.nextCursor;
        if (cursor === null || stories.some((item) => item.id === story.id)) break;
      }
    } catch (error: unknown) {
      if (!this.isNav(nav)) return;
      if (error instanceof StoriesError && error.code === 'author-not-found') {
        stories = [];
        cursor = null;
      } else {
        // Offline: keep what we have; the media request below still asks the backend.
        this.acquire(story, false);
        this.publish();
        return;
      }
    }
    const entry = this.entry(authorId);
    entry.generation += 1;
    entry.loading = null;
    entry.stories = stories;
    entry.nextCursor = cursor;
    entry.status = 'loaded';
    const stillThere = stories.findIndex((item) => item.id === story.id);
    if (stillThere >= 0) {
      this.index = stillThere;
      // Same Story, same playKey: playback resumes its remaining time once re-authorized.
      this.acquire(story, false);
      this.publish();
      return;
    }
    if (stories.length > 0) { this.show(authorId, Math.min(this.index, stories.length - 1)); return; }
    await this.nextAuthor(++this.nav, 'close');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.nav += 1;
    this.mediaToken += 1;
    this.current?.request.cancel();
    this.prefetch?.request.cancel();
    this.current = null;
    this.prefetch = null;
    this.listeners.clear();
  }

  // ------------------------------------------------------------------ navigation

  private async enter(authorId: string, mode: 'first-unseen' | 'last', nav: number): Promise<EnterOutcome> {
    const entry = this.entry(authorId);
    for (let pages = 0; pages < MAX_PAGES_PER_SCAN; pages += 1) {
      const needsMore = entry.status === 'unloaded' || (entry.status === 'loaded' && entry.nextCursor !== null &&
        (mode === 'last' || this.firstUnseen(entry.stories) === null));
      if (!needsMore) break;
      const before = entry.stories.length;
      const cursorBefore = entry.nextCursor;
      await this.loadNextPage(authorId);
      if (!this.isNav(nav)) return 'stale';
      if (entry.status === 'loaded' && entry.stories.length === before && entry.nextCursor === cursorBefore &&
          before > 0) break;
    }
    if (!this.isNav(nav)) return 'stale';
    if (entry.status === 'not-found') return 'not-found';
    if (entry.status !== 'loaded') return 'error';
    if (entry.stories.length === 0) return 'empty';
    const index = mode === 'last' ? entry.stories.length - 1 : this.firstUnseen(entry.stories) ?? 0;
    this.show(authorId, index);
    return 'entered';
  }

  private async nextAuthor(nav: number, whenNone: 'close' | 'unavailable'): Promise<void> {
    await this.trayLoading;
    if (!this.isNav(nav)) return;
    const from = this.currentAuthorId;
    let position = from === null ? -1 : this.position(from);
    for (let steps = 0; steps < MAX_PAGES_PER_SCAN * 20; steps += 1) {
      position += 1;
      if (position >= this.order.length) {
        if (!this.inTray || this.trayCursor === null) break;
        await this.loadTrayPage();
        if (!this.isNav(nav)) return;
        if (position >= this.order.length) break;
      }
      const candidate = this.order[position];
      if (candidate === undefined) break;
      const outcome = await this.enter(candidate.id, 'first-unseen', nav);
      if (outcome === 'entered' || outcome === 'stale') return;
      // empty / gone / failing author: skip it (fail-soft).
    }
    if (whenNone === 'unavailable') this.setStatus('unavailable');
    else this.close();
  }

  private show(authorId: string, index: number): void {
    const story = this.entry(authorId).stories[index];
    if (story === undefined || this.disposed) return;
    const replay = this.current?.storyId === story.id && this.media.status === 'loaded' &&
      this.media.storyId === story.id;
    this.currentAuthorId = authorId;
    this.index = index;
    // A new playKey restarts progress from 0; replaying the image already on screen
    // needs no new acquisition.
    this.showSeq += 1;
    if (!replay) this.acquire(story);
    this.publish('ready');
    this.loadAheadIfNeeded(authorId);
  }

  private close(): void {
    if (this.disposed || this.state.status === 'closed') return;
    this.mediaToken += 1;
    this.current?.request.cancel();
    this.prefetch?.request.cancel();
    this.current = null;
    this.prefetch = null;
    this.setStatus('closed');
    this.deps.onClose();
  }

  // ------------------------------------------------------------------ media

  private acquire(story: Story, adoptPrefetch = true): void {
    const token = ++this.mediaToken;
    const previous = this.current;
    let request: PostImageRequest<TImage>;
    if (adoptPrefetch && this.prefetch?.storyId === story.id) {
      request = this.prefetch.request;
      this.prefetch = null;
    } else {
      if (this.prefetch !== null && this.prefetch.storyId !== this.nextStoryId(story)) {
        this.prefetch.request.cancel();
        this.prefetch = null;
      }
      request = this.deps.images.request(this.deps.mediaKey(story));
    }
    this.current = { storyId: story.id, request };
    // Released AFTER the new lease exists: re-requesting the same image keeps its job.
    previous?.request.cancel();
    this.media = { status: 'loading', storyId: story.id };
    this.displayedStoryId = null;
    void request.result.then((outcome) => this.onMediaOutcome(token, story, outcome));
  }

  private onMediaOutcome(token: number, story: Story, outcome: PostImageOutcome<TImage>): void {
    if (this.disposed || token !== this.mediaToken || outcome.status === 'cancelled') return;
    if (outcome.status === 'loaded') {
      this.media = { status: 'loaded', storyId: story.id, image: outcome.image };
      this.publish();
      return;
    }
    if (outcome.error.code === 'not-found') {
      // Expired, hidden or deleted: no longer playable. Never marked seen; skip it.
      void this.dropStory(story);
      return;
    }
    this.media = { status: 'failed', storyId: story.id };
    this.publish();
  }

  private async dropStory(story: Story): Promise<void> {
    const authorId = story.author.id;
    const entry = this.entry(authorId);
    const position = entry.stories.findIndex((item) => item.id === story.id);
    if (position < 0 || this.currentAuthorId !== authorId) return;
    entry.stories = entry.stories.filter((item) => item.id !== story.id);
    const nav = ++this.nav;
    this.completeIfAllSeen(authorId);
    if (position < entry.stories.length) { this.show(authorId, position); return; }
    if (entry.nextCursor !== null) {
      await this.loadNextPage(authorId);
      if (!this.isNav(nav)) return;
      if (position < entry.stories.length) { this.show(authorId, position); return; }
    }
    await this.nextAuthor(nav, 'close');
  }

  // At most ONE warm-up: the next Story of the same author, through the same cache.
  private prefetchNext(): void {
    const story = this.state.story;
    if (story === null) return;
    const nextId = this.nextStoryId(story);
    const next = nextId === null ? undefined : this.entry(story.author.id).stories.find((item) => item.id === nextId);
    if (next === undefined || this.prefetch?.storyId === next.id) return;
    this.prefetch?.request.cancel();
    this.prefetch = { storyId: next.id, request: this.deps.images.request(this.deps.mediaKey(next)) };
  }

  private nextStoryId(story: Story): string | null {
    const stories = this.entry(story.author.id).stories;
    const position = stories.findIndex((item) => item.id === story.id);
    return stories[position + 1]?.id ?? null;
  }

  // ------------------------------------------------------------------ data

  private completeIfAllSeen(authorId: string): void {
    const entry = this.entry(authorId);
    if (entry.status !== 'loaded' || entry.nextCursor !== null || entry.stories.length === 0) return;
    if (entry.stories.every((story) => this.deps.seen.isStorySeen(this.ownerUserId, story.id))) {
      this.deps.seen.completeAuthor(this.ownerUserId, entry.stories);
    }
  }

  private firstUnseen(stories: readonly Story[]): number | null {
    const position = stories.findIndex((story) => !this.deps.seen.isStorySeen(this.ownerUserId, story.id));
    return position < 0 ? null : position;
  }

  // Near the end of what is loaded, quietly fetch the next page of the same author.
  private loadAheadIfNeeded(authorId: string): void {
    const entry = this.entry(authorId);
    if (entry.nextCursor === null || this.index < entry.stories.length - 2) return;
    void this.loadNextPage(authorId).then(() => {
      if (!this.disposed && this.currentAuthorId === authorId) this.publish();
    });
  }

  private loadNextPage(authorId: string): Promise<void> {
    const entry = this.entry(authorId);
    if (entry.loading !== null) return entry.loading;
    if (entry.status === 'not-found' || (entry.status === 'loaded' && entry.nextCursor === null)) {
      return Promise.resolve();
    }
    const generation = entry.generation;
    const cursor = entry.status === 'loaded' ? entry.nextCursor : null;
    const loading = (async () => {
      try {
        const page = await Promise.resolve().then(() =>
          this.deps.getStoriesPage.execute(this.ownerUserId, authorId, cursor));
        if (this.disposed || entry.generation !== generation) return;
        entry.stories = appendNew(entry.status === 'loaded' ? entry.stories : [], page.stories);
        entry.nextCursor = page.nextCursor;
        entry.status = 'loaded';
      } catch (error: unknown) {
        if (this.disposed || entry.generation !== generation) return;
        if (error instanceof StoriesError && error.code === 'author-not-found') {
          entry.status = 'not-found';
          entry.stories = [];
          entry.nextCursor = null;
        } else if (entry.status === 'unloaded') {
          entry.status = 'error';
        }
      }
    })();
    entry.loading = loading;
    void loading.finally(() => { if (entry.loading === loading) entry.loading = null; });
    return loading;
  }

  private async locateInTray(authorId: string): Promise<void> {
    try {
      for (let pages = 0; pages < MAX_PAGES_PER_SCAN; pages += 1) {
        await this.loadTrayPage();
        if (this.disposed) return;
        if (this.order.some((author) => author.id === authorId)) { this.inTray = true; return; }
        if (this.trayCursor === null) break;
      }
    } catch {
      // Tray unavailable: the viewer still works for this author alone.
    }
    if (this.disposed) return;
    this.inTray = false;
    this.order = [];
  }

  private async loadTrayPage(): Promise<void> {
    const cursor = this.trayCursor;
    if (this.order.length > 0 && cursor === null) return;
    const page = await Promise.resolve().then(() => this.deps.getTrayPage.execute(this.ownerUserId, cursor));
    if (this.disposed) return;
    const known = new Set(this.order.map((author) => author.id));
    for (const tray of page.trays) {
      if (!known.has(tray.author.id)) { known.add(tray.author.id); this.order.push(tray.author); }
    }
    this.trayCursor = page.nextCursor;
  }

  private position(authorId: string): number {
    return this.order.findIndex((author) => author.id === authorId);
  }

  private entry(authorId: string): AuthorStories {
    let entry = this.authors.get(authorId);
    if (entry === undefined) {
      entry = { stories: [], nextCursor: null, status: 'unloaded', loading: null, generation: 0 };
      this.authors.set(authorId, entry);
    }
    return entry;
  }

  private isNav(nav: number): boolean {
    return !this.disposed && nav === this.nav;
  }

  // ------------------------------------------------------------------ state

  private setStatus(status: Exclude<StoriesViewerState<TImage>['status'], 'ready'>): void {
    if (this.disposed) return;
    this.state = { ...this.state, status };
    this.emit();
  }

  private publish(status?: 'ready'): void {
    if (this.disposed) return;
    const authorId = this.currentAuthorId;
    const stories = authorId === null ? [] : this.entry(authorId).stories;
    const story = stories[this.index] ?? null;
    this.state = {
      status: status ?? this.state.status,
      author: story?.author ?? this.order.find((author) => author.id === authorId) ?? null,
      stories,
      index: this.index,
      story,
      media: this.media,
      displayedStoryId: this.displayedStoryId,
      playKey: story === null ? null : `${story.id}#${this.showSeq}`,
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function appendNew(current: Story[], incoming: readonly Story[]): Story[] {
  const known = new Set(current.map((story) => story.id));
  const added = incoming.filter((story) => !known.has(story.id));
  return added.length === 0 ? current : [...current, ...added];
}
