import type { Story, StoryTray } from '@/features/stories/domain/story';
import {
  isTrayFullySeen, toExpiresAtMs, type StoryAuthorSeenSnapshot, type StorySeenStore,
} from '@/features/stories/domain/story-seen';
import { normalizeStoryUuid } from '@/features/stories/domain/story-values';

type OwnerSeen = {
  storyIds: Set<string>;
  snapshots: Map<string, StoryAuthorSeenSnapshot>;
  loading: Promise<void> | null;
  loaded: boolean;
  // SQLite failed for this owner: seen keeps working in memory for this session.
  persistenceFailed: boolean;
};

// Local, per-owner "seen" state for Stories. Memory answers immediately; SQLite is
// written behind it. Everything is keyed by owner, so a late load or write of owner A
// can only ever touch A's entry: B never inherits A's rings.
export class StorySeenTracker {
  private readonly owners = new Map<string, OwnerSeen>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(private readonly store: StorySeenStore, private readonly now: () => number = Date.now) {}

  // Bound (arrow) members: React's useSyncExternalStore calls them detached.
  getVersion = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  // Loads (and lazily prunes) the owner's persisted state once. Marks made while the
  // load was in flight are kept: memory is merged, never replaced.
  ensureLoaded(ownerUserId: string): Promise<void> {
    const owner = normalizeStoryUuid(ownerUserId);
    if (owner === null) return Promise.resolve();
    const entry = this.entry(owner);
    if (entry.loaded) return Promise.resolve();
    if (entry.loading !== null) return entry.loading;
    entry.loading = (async () => {
      try {
        const persisted = await this.store.load(owner, this.now());
        for (const storyId of persisted.storyIds) entry.storyIds.add(storyId);
        for (const snapshot of persisted.snapshots) {
          const current = entry.snapshots.get(snapshot.authorId);
          if (current === undefined || current.completedAtMs < snapshot.completedAtMs) {
            entry.snapshots.set(snapshot.authorId, snapshot);
          }
        }
      } catch {
        entry.persistenceFailed = true;
      } finally {
        entry.loaded = true;
        entry.loading = null;
        this.notify();
      }
    })();
    return entry.loading;
  }

  isStorySeen(ownerUserId: string, storyId: string): boolean {
    return this.owners.get(ownerUserId)?.storyIds.has(storyId) ?? false;
  }

  isTrayFullySeen(ownerUserId: string, tray: StoryTray): boolean {
    return isTrayFullySeen(tray, this.owners.get(ownerUserId)?.snapshots.get(tray.author.id));
  }

  persistenceFailed(ownerUserId: string): boolean {
    return this.owners.get(ownerUserId)?.persistenceFailed ?? false;
  }

  // Idempotent. Memory first (the UI reacts now), then a best-effort durable write.
  markSeen(ownerUserId: string, story: Story): void {
    const owner = normalizeStoryUuid(ownerUserId);
    const expiresAtMs = toExpiresAtMs(story.expiresAt);
    if (owner === null || expiresAtMs === null) return;
    const entry = this.entry(owner);
    if (entry.storyIds.has(story.id)) return;
    entry.storyIds.add(story.id);
    this.notify();
    const nowMs = this.now();
    void this.store.markSeen(owner, { storyId: story.id, authorId: story.author.id, expiresAtMs, seenAtMs: nowMs }, nowMs)
      .catch(() => { entry.persistenceFailed = true; });
  }

  // Called when every active Story of the author (no further page) has been seen.
  completeAuthor(ownerUserId: string, stories: readonly Story[]): void {
    const owner = normalizeStoryUuid(ownerUserId);
    const latest = stories[stories.length - 1];
    if (owner === null || latest === undefined) return;
    const entry = this.entry(owner);
    if (!stories.every((story) => entry.storyIds.has(story.id))) return;
    const expiresAtMs = toExpiresAtMs(latest.expiresAt);
    if (expiresAtMs === null) return;
    const snapshot: StoryAuthorSeenSnapshot = {
      authorId: latest.author.id,
      latestStoryCreatedAt: latest.createdAt,
      activeStoryCount: stories.length,
      expiresAtMs,
      completedAtMs: this.now(),
    };
    const previous = entry.snapshots.get(snapshot.authorId);
    if (previous !== undefined && previous.latestStoryCreatedAt === snapshot.latestStoryCreatedAt &&
        previous.activeStoryCount === snapshot.activeStoryCount) return;
    entry.snapshots.set(snapshot.authorId, snapshot);
    this.notify();
    void this.store.saveSnapshot(owner, snapshot, snapshot.completedAtMs)
      .catch(() => { entry.persistenceFailed = true; });
  }

  private entry(owner: string): OwnerSeen {
    let entry = this.owners.get(owner);
    if (entry === undefined) {
      entry = { storyIds: new Set(), snapshots: new Map(), loading: null, loaded: false, persistenceFailed: false };
      this.owners.set(owner, entry);
    }
    return entry;
  }

  private notify(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }
}
