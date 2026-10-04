import type { StoriesLocalDatabase } from '@/features/stories/data/stories-local-database';
import { StoriesError } from '@/features/stories/domain/stories-error';
import type {
  OwnerSeenState, StoryAuthorSeenSnapshot, StorySeenEntry, StorySeenStore,
} from '@/features/stories/domain/story-seen';
import { normalizeStoryUuid } from '@/features/stories/domain/story-values';

type SeenRow = { story_id: unknown };
type SnapshotRow = {
  author_id: unknown; latest_story_created_at: unknown; active_story_count: unknown;
  expires_at_ms: unknown; completed_at_ms: unknown;
};

// Local seen state in its own database. Every statement is scoped by owner_user_id, so
// two accounts on one device never share it. Expired rows are pruned lazily (on load
// and on every write); there is no timer and no background job.
export class SQLiteStorySeenStore implements StorySeenStore {
  private database: Promise<StoriesLocalDatabase> | null = null;

  constructor(private readonly open: () => Promise<StoriesLocalDatabase>) {}

  async load(ownerUserId: string, nowMs: number): Promise<OwnerSeenState> {
    const owner = requireCanonical(ownerUserId);
    const db = await this.db();
    await this.prune(db, nowMs);
    const seen = await db.getAllAsync<SeenRow>(
      'SELECT story_id FROM story_seen WHERE owner_user_id = ? ORDER BY story_id', [owner],
    );
    const snapshots = await db.getAllAsync<SnapshotRow>(
      `SELECT author_id, latest_story_created_at, active_story_count, expires_at_ms, completed_at_ms
       FROM story_author_seen_snapshot WHERE owner_user_id = ? ORDER BY author_id`, [owner],
    );
    return {
      storyIds: seen.flatMap((row) => (typeof row.story_id === 'string' ? [row.story_id] : [])),
      snapshots: snapshots.flatMap((row) => {
        const snapshot = parseSnapshot(row);
        return snapshot === null ? [] : [snapshot];
      }),
    };
  }

  async markSeen(ownerUserId: string, entry: StorySeenEntry, nowMs: number): Promise<void> {
    const owner = requireCanonical(ownerUserId);
    const storyId = requireCanonical(entry.storyId);
    const authorId = requireCanonical(entry.authorId);
    if (!isInstant(entry.expiresAtMs) || entry.expiresAtMs <= 0 || !isInstant(entry.seenAtMs)) {
      throw new StoriesError('invalid-request');
    }
    const db = await this.db();
    await this.prune(db, nowMs);
    // Already expired locally: nothing worth keeping.
    if (entry.expiresAtMs <= nowMs) return;
    await db.runAsync(
      `INSERT INTO story_seen (owner_user_id, story_id, author_id, expires_at_ms, seen_at_ms)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (owner_user_id, story_id) DO NOTHING`,
      [owner, storyId, authorId, entry.expiresAtMs, entry.seenAtMs],
    );
  }

  async saveSnapshot(ownerUserId: string, snapshot: StoryAuthorSeenSnapshot, nowMs: number): Promise<void> {
    const owner = requireCanonical(ownerUserId);
    const authorId = requireCanonical(snapshot.authorId);
    if (snapshot.latestStoryCreatedAt === '' || !Number.isSafeInteger(snapshot.activeStoryCount) ||
        snapshot.activeStoryCount < 1 || !isInstant(snapshot.expiresAtMs) || snapshot.expiresAtMs <= 0 ||
        !isInstant(snapshot.completedAtMs)) {
      throw new StoriesError('invalid-request');
    }
    const db = await this.db();
    await this.prune(db, nowMs);
    if (snapshot.expiresAtMs <= nowMs) return;
    await db.runAsync(
      `INSERT INTO story_author_seen_snapshot
         (owner_user_id, author_id, latest_story_created_at, active_story_count, expires_at_ms, completed_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (owner_user_id, author_id) DO UPDATE SET
         latest_story_created_at = excluded.latest_story_created_at,
         active_story_count = excluded.active_story_count,
         expires_at_ms = excluded.expires_at_ms,
         completed_at_ms = excluded.completed_at_ms`,
      [owner, authorId, snapshot.latestStoryCreatedAt, snapshot.activeStoryCount,
        snapshot.expiresAtMs, snapshot.completedAtMs],
    );
  }

  // Housekeeping only (device clock); authorization never depends on it.
  private async prune(db: StoriesLocalDatabase, nowMs: number): Promise<void> {
    if (!isInstant(nowMs)) throw new StoriesError('invalid-request');
    await db.runAsync('DELETE FROM story_seen WHERE expires_at_ms <= ?', [nowMs]);
    await db.runAsync('DELETE FROM story_author_seen_snapshot WHERE expires_at_ms <= ?', [nowMs]);
  }

  // Opened lazily; a failed open is retried on the next call.
  private db(): Promise<StoriesLocalDatabase> {
    if (this.database === null) {
      const opening = this.open();
      this.database = opening;
      opening.catch(() => {
        if (this.database === opening) this.database = null;
      });
    }
    return this.database;
  }
}

function requireCanonical(value: string): string {
  const id = normalizeStoryUuid(value);
  if (id === null || id !== value) throw new StoriesError('invalid-request');
  return id;
}

function isInstant(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function parseSnapshot(row: SnapshotRow): StoryAuthorSeenSnapshot | null {
  if (typeof row.author_id !== 'string' || typeof row.latest_story_created_at !== 'string' ||
      typeof row.active_story_count !== 'number' || typeof row.expires_at_ms !== 'number' ||
      typeof row.completed_at_ms !== 'number') return null;
  return {
    authorId: row.author_id,
    latestStoryCreatedAt: row.latest_story_created_at,
    activeStoryCount: row.active_story_count,
    expiresAtMs: row.expires_at_ms,
    completedAtMs: row.completed_at_ms,
  };
}
