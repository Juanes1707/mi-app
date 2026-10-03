import type { SQLiteDatabase } from 'expo-sqlite';

import { OfflineSyncError } from '@/features/offline-sync/domain/offline-sync-error';

// The subset of expo-sqlite's async API the queue relies on.
export type OfflineMutationDatabase = Pick<
  SQLiteDatabase,
  'execAsync' | 'runAsync' | 'getFirstAsync' | 'getAllAsync' | 'withExclusiveTransactionAsync' | 'closeAsync'
>;

export const OFFLINE_MUTATIONS_DATABASE_NAME = 'offline-mutations.db';
export const CURRENT_DATABASE_VERSION = 1;

// - WAL: readers do not block the writer, so a future worker can read the queue
//   while new intentions are appended.
// - synchronous = FULL: in WAL mode, NORMAL may lose the last commits on power loss;
//   FULL syncs every commit, so a resolved enqueue() survives it.
// - foreign_keys: enforced per connection (no foreign keys yet; kept for future tables).
const CONNECTION_PRAGMAS = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
`;

// Key = target user_version; each script migrates (key - 1) → key. Never edit a
// shipped script: add the next version instead, so pending entries are preserved.
const MIGRATIONS: Readonly<Record<number, string>> = {
  // AUTOINCREMENT (not plain rowid) guarantees sequences are never reused, even after
  // the newest rows were deleted, so `sequence` is a total, monotonic local order.
  // Owner keys are stored canonical (lowercase): a differently spelled owner would be
  // invisible to owner-scoped queries, i.e. silently skipped, so it cannot be stored.
  1: `
CREATE TABLE offline_mutations (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id TEXT NOT NULL
    CHECK (length(owner_user_id) = 36 AND owner_user_id = lower(owner_user_id)),
  kind TEXT NOT NULL CHECK (length(kind) > 0),
  entity_key TEXT NOT NULL CHECK (length(entity_key) > 0),
  payload_version INTEGER NOT NULL CHECK (payload_version > 0),
  payload_json TEXT NOT NULL,
  enqueued_at_ms INTEGER NOT NULL CHECK (enqueued_at_ms >= 0)
) STRICT;

CREATE INDEX offline_mutations_owner_sequence_idx
  ON offline_mutations (owner_user_id, sequence ASC);

CREATE INDEX offline_mutations_owner_entity_sequence_idx
  ON offline_mutations (owner_user_id, kind, entity_key, sequence DESC);
`,
};

async function readUserVersion(db: Pick<SQLiteDatabase, 'getFirstAsync'>): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: unknown }>('PRAGMA user_version');
  const version = row?.user_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) {
    throw new OfflineSyncError('unavailable');
  }
  return version;
}

async function migrate(db: OfflineMutationDatabase): Promise<void> {
  const version = await readUserVersion(db);
  // Written by a newer app version: refuse to touch it. Never wipe pending intentions.
  if (version > CURRENT_DATABASE_VERSION) throw new OfflineSyncError('unsupported-version');

  for (let target = version + 1; target <= CURRENT_DATABASE_VERSION; target += 1) {
    const script = MIGRATIONS[target];
    if (script === undefined) throw new OfflineSyncError('unavailable');
    // DDL + version bump commit together or not at all.
    await db.withExclusiveTransactionAsync(async (txn) => {
      if (await readUserVersion(txn) !== target - 1) throw new OfflineSyncError('unavailable');
      await txn.execAsync(script);
      // `target` is a code constant (PRAGMA values cannot be bound as parameters).
      await txn.execAsync(`PRAGMA user_version = ${target}`);
    });
  }
}

// Configures and migrates a freshly opened connection. On any failure the connection
// is closed and nothing is deleted: this database holds user intentions, not a cache.
export async function prepareOfflineMutationDatabase<TDatabase extends OfflineMutationDatabase>(
  db: TDatabase,
): Promise<TDatabase> {
  try {
    await db.execAsync(CONNECTION_PRAGMAS);
    await migrate(db);
    return db;
  } catch (error: unknown) {
    await db.closeAsync().catch(() => undefined);
    throw error instanceof OfflineSyncError ? error : new OfflineSyncError('unavailable', { cause: error });
  }
}
