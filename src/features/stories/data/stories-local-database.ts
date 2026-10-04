import type { SQLiteDatabase } from 'expo-sqlite';

import { StoriesError } from '@/features/stories/domain/stories-error';

// The subset of expo-sqlite's async API the local Stories store relies on.
export type StoriesLocalDatabase = Pick<
  SQLiteDatabase,
  'execAsync' | 'runAsync' | 'getFirstAsync' | 'getAllAsync' | 'withExclusiveTransactionAsync' | 'closeAsync'
>;

// Its own bounded context: never the offline mutation queue's database.
export const STORIES_LOCAL_DATABASE_NAME = 'stories-local.db';
export const STORIES_LOCAL_DATABASE_VERSION = 1;

// Local UX state, not user intentions: losing the last mark on power loss is harmless,
// so NORMAL sync is enough under WAL.
const CONNECTION_PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
`;

const CANONICAL_ID = (column: string) =>
  `CHECK (length(${column}) = 36 AND ${column} = lower(${column}))`;

// Key = target user_version; each script migrates (key - 1) -> key. Never edit a
// shipped script: add the next version instead.
const MIGRATIONS: Readonly<Record<number, string>> = {
  1: `
CREATE TABLE story_seen (
  owner_user_id TEXT NOT NULL ${CANONICAL_ID('owner_user_id')},
  story_id TEXT NOT NULL ${CANONICAL_ID('story_id')},
  author_id TEXT NOT NULL ${CANONICAL_ID('author_id')},
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > 0),
  seen_at_ms INTEGER NOT NULL CHECK (seen_at_ms >= 0),
  PRIMARY KEY (owner_user_id, story_id)
) STRICT;

CREATE INDEX story_seen_expires_idx ON story_seen (expires_at_ms);

CREATE TABLE story_author_seen_snapshot (
  owner_user_id TEXT NOT NULL ${CANONICAL_ID('owner_user_id')},
  author_id TEXT NOT NULL ${CANONICAL_ID('author_id')},
  latest_story_created_at TEXT NOT NULL CHECK (length(latest_story_created_at) > 0),
  active_story_count INTEGER NOT NULL CHECK (active_story_count >= 1),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms > 0),
  completed_at_ms INTEGER NOT NULL CHECK (completed_at_ms >= 0),
  PRIMARY KEY (owner_user_id, author_id)
) STRICT;

CREATE INDEX story_author_seen_snapshot_expires_idx ON story_author_seen_snapshot (expires_at_ms);
`,
};

async function readUserVersion(db: Pick<SQLiteDatabase, 'getFirstAsync'>): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: unknown }>('PRAGMA user_version');
  const version = row?.user_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new StoriesError('unavailable');
  }
  return version;
}

async function migrate(db: StoriesLocalDatabase): Promise<void> {
  const version = await readUserVersion(db);
  // Written by a newer app version: do not interpret it (the caller degrades to memory).
  if (version > STORIES_LOCAL_DATABASE_VERSION) throw new StoriesError('unavailable');
  for (let target = version + 1; target <= STORIES_LOCAL_DATABASE_VERSION; target += 1) {
    const script = MIGRATIONS[target];
    if (script === undefined) throw new StoriesError('unavailable');
    await db.withExclusiveTransactionAsync(async (txn) => {
      if (await readUserVersion(txn) !== target - 1) throw new StoriesError('unavailable');
      await txn.execAsync(script);
      // `target` is a code constant (PRAGMA values cannot be bound as parameters).
      await txn.execAsync(`PRAGMA user_version = ${target}`);
    });
  }
}

// Configures and migrates a freshly opened connection; on failure it is closed.
export async function prepareStoriesLocalDatabase<TDatabase extends StoriesLocalDatabase>(
  db: TDatabase,
): Promise<TDatabase> {
  try {
    await db.execAsync(CONNECTION_PRAGMAS);
    await migrate(db);
    return db;
  } catch (error: unknown) {
    await db.closeAsync().catch(() => undefined);
    throw error instanceof StoriesError ? error : new StoriesError('unavailable');
  }
}
