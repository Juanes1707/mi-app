import {
  SET_POST_LIKE, type EnqueueSetPostLikeInput, type QueuedOfflineMutation,
  type QueuedSetPostLikeMutation,
} from '@/features/offline-sync/domain/offline-mutation';
import type { OfflineMutationQueue } from '@/features/offline-sync/domain/offline-mutation-queue';
import { OfflineSyncError } from '@/features/offline-sync/domain/offline-sync-error';
import { normalizeUuid } from '@/features/offline-sync/domain/uuid';
import type { OfflineMutationDatabase } from './offline-mutation-database';
import {
  decodeOfflineMutationRow, encodeSetPostLikePayload, MUTATION_COLUMNS,
  SET_POST_LIKE_PAYLOAD_VERSION,
} from './offline-mutation-row';
import { SerialExecutor } from './serial-executor';

// Every value reaches SQLite as a bound parameter; only these constants are SQL text.
const INSERT_MUTATION = `INSERT INTO offline_mutations
  (owner_user_id, kind, entity_key, payload_version, payload_json, enqueued_at_ms)
  VALUES (?, ?, ?, ?, ?, ?)`;
const SELECT_BY_SEQUENCE =
  `SELECT ${MUTATION_COLUMNS} FROM offline_mutations WHERE owner_user_id = ? AND sequence = ?`;
const SELECT_OLDEST =
  `SELECT ${MUTATION_COLUMNS} FROM offline_mutations WHERE owner_user_id = ? ORDER BY sequence ASC LIMIT 1`;
const SELECT_PENDING =
  `SELECT ${MUTATION_COLUMNS} FROM offline_mutations WHERE owner_user_id = ? ORDER BY sequence ASC`;
const SELECT_LATEST_FOR_ENTITY = `SELECT ${MUTATION_COLUMNS} FROM offline_mutations
  WHERE owner_user_id = ? AND kind = ? AND entity_key = ? ORDER BY sequence DESC LIMIT 1`;
const DELETE_MUTATION = 'DELETE FROM offline_mutations WHERE owner_user_id = ? AND sequence = ?';
const COUNT_PENDING = 'SELECT count(*) AS pending FROM offline_mutations WHERE owner_user_id = ?';

function requireOwner(ownerUserId: string): string {
  const owner = normalizeUuid(ownerUserId);
  if (owner === null) throw new OfflineSyncError('invalid-input');
  return owner;
}

export class SQLiteOfflineMutationQueue implements OfflineMutationQueue {
  // Writes AND reads go through one executor: calls are applied in invocation order,
  // and a read always observes every write requested before it.
  private readonly executor = new SerialExecutor();
  private database: OfflineMutationDatabase | null = null;

  constructor(
    private readonly connect: () => Promise<OfflineMutationDatabase>,
    private readonly now: () => number = Date.now,
  ) {}

  enqueueSetPostLike(input: EnqueueSetPostLikeInput): Promise<QueuedSetPostLikeMutation> {
    // Captured when the user acted (diagnostic only; ordering comes from `sequence`).
    const enqueuedAtMs = this.now();
    return this.serialized(async (db) => {
      const ownerUserId = requireOwner(input.ownerUserId);
      const postId = normalizeUuid(input.postId);
      if (postId === null || typeof input.liked !== 'boolean' ||
        !Number.isSafeInteger(enqueuedAtMs) || enqueuedAtMs < 0) {
        throw new OfflineSyncError('invalid-input');
      }
      // A plain INSERT is a single autocommit statement: when runAsync resolves the
      // row is committed. The SELECT then returns exactly what was persisted.
      const result = await db.runAsync(INSERT_MUTATION, [
        ownerUserId, SET_POST_LIKE, postId, SET_POST_LIKE_PAYLOAD_VERSION,
        encodeSetPostLikePayload(postId, input.liked), enqueuedAtMs,
      ]);
      const row = await db.getFirstAsync<unknown>(SELECT_BY_SEQUENCE, [ownerUserId, result.lastInsertRowId]);
      const mutation = decodeOfflineMutationRow(row);
      if (mutation.kind !== SET_POST_LIKE) throw new OfflineSyncError('corrupt-data');
      return mutation;
    });
  }

  peekOldest(ownerUserId: string): Promise<QueuedOfflineMutation | null> {
    return this.serialized(async (db) => {
      const row = await db.getFirstAsync<unknown>(SELECT_OLDEST, [requireOwner(ownerUserId)]);
      return row === null ? null : decodeOfflineMutationRow(row);
    });
  }

  listPending(ownerUserId: string): Promise<QueuedOfflineMutation[]> {
    return this.serialized(async (db) => {
      const rows = await db.getAllAsync<unknown>(SELECT_PENDING, [requireOwner(ownerUserId)]);
      return rows.map(decodeOfflineMutationRow);
    });
  }

  getLatestSetPostLike(ownerUserId: string, postId: string): Promise<QueuedSetPostLikeMutation | null> {
    return this.serialized(async (db) => {
      const entityKey = normalizeUuid(postId);
      if (entityKey === null) throw new OfflineSyncError('invalid-input');
      const row = await db.getFirstAsync<unknown>(
        SELECT_LATEST_FOR_ENTITY, [requireOwner(ownerUserId), SET_POST_LIKE, entityKey],
      );
      if (row === null) return null;
      const mutation = decodeOfflineMutationRow(row);
      if (mutation.kind !== SET_POST_LIKE) throw new OfflineSyncError('corrupt-data');
      return mutation;
    });
  }

  // Scoped by owner AND sequence: a session mix-up can never delete another user's entry.
  remove(ownerUserId: string, sequence: number): Promise<boolean> {
    return this.serialized(async (db) => {
      const owner = requireOwner(ownerUserId);
      if (!Number.isSafeInteger(sequence) || sequence <= 0) throw new OfflineSyncError('invalid-input');
      const result = await db.runAsync(DELETE_MUTATION, [owner, sequence]);
      return result.changes === 1;
    });
  }

  count(ownerUserId: string): Promise<number> {
    return this.serialized(async (db) => {
      const row = await db.getFirstAsync<{ pending: unknown }>(COUNT_PENDING, [requireOwner(ownerUserId)]);
      const pending = row?.pending;
      if (typeof pending !== 'number' || !Number.isSafeInteger(pending) || pending < 0) {
        throw new OfflineSyncError('unavailable');
      }
      return pending;
    });
  }

  private serialized<T>(task: (db: OfflineMutationDatabase) => Promise<T>): Promise<T> {
    return this.executor.run(async () => {
      try {
        return await task(await this.open());
      } catch (error: unknown) {
        // Callers see a domain code, never raw SQLite messages (kept as `cause`).
        throw error instanceof OfflineSyncError ? error : new OfflineSyncError('unavailable', { cause: error });
      }
    });
  }

  // Lazy, single initialization: it runs inside the executor, so concurrent first
  // calls open and migrate the database exactly once. A failed open leaves no
  // half-initialized connection behind and is retried by the next call.
  private async open(): Promise<OfflineMutationDatabase> {
    if (this.database === null) this.database = await this.connect();
    return this.database;
  }
}
