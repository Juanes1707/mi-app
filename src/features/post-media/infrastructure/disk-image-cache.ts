import { SerialTaskQueue } from './serial-task-queue';

export type DiskDirectoryEntry = { name: string; isDirectory: boolean };

// Narrow port over OUR managed directory. Every name is a bare entry name inside
// it, so the cache can never address files outside that directory.
export interface DiskCacheFileSystem {
  ensureDirectory(): void;
  // Deletes only the managed directory and recreates it empty.
  resetDirectory(): void;
  listEntries(): DiskDirectoryEntry[];
  deleteEntry(entry: DiskDirectoryEntry): void;
  readText(name: string): Promise<string | null>;
  // Writes a temporary sibling first and then replaces `name`, so a crash
  // leaves either the old or the new index, never a torn one.
  writeTextAtomically(name: string, content: string): Promise<void>;
  fileSize(name: string): number | null;
  moveReplacing(fromName: string, toName: string): Promise<void>;
  deleteFile(name: string): void;
  uriOf(name: string): string;
}

export type PartialDownloadTarget = { name: string; uri: string };

export type DiskImageCacheOptions = {
  budgetBytes: number;
  maxFileBytes: number;
  touchPersistDelayMs?: number;
};

export class DiskCacheValidationError extends Error {
  constructor() {
    super('Downloaded post media is not a valid cache file.');
    this.name = 'DiskCacheValidationError';
  }
}

type DiskEntry = { fileName: string; sizeBytes: number; lastAccessSequence: number };
type PersistedEntry = DiskEntry & { imagePath: string };
// Never contains signed URLs, tokens or identities: only stable keys, sizes and LRU order.
type PersistedIndex = { version: 1; accessSequence: number; entries: PersistedEntry[] };

const INDEX_FILE_NAME = 'index.json';
const INDEX_VERSION = 1;
const DEFAULT_TOUCH_PERSIST_DELAY_MS = 1000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Cache keys are stable media identities, never URLs. Post media keeps its original
// key space (the bare `author/media.ext` imagePath, as already persisted on devices);
// every other bucket is namespaced (`story-media:author/media.ext`), so the same
// object path in two buckets can never share a RAM entry, an index entry or a file.
const CACHE_KEY_PATTERN = new RegExp(`^(?:(story-media):)?(${UUID})/(${UUID})\\.(jpg|png|webp)$`);

// `author/media.ext` → `author__media.ext`, `story-media:author/media.ext` →
// `story-media__author__media.ext`: deterministic, flat and free of separators.
export function toCacheFileName(cacheKey: string): string | null {
  const match = CACHE_KEY_PATTERN.exec(cacheKey);
  if (!match) return null;
  const file = `${match[2]}__${match[3]}.${match[4]}`;
  return match[1] === undefined ? file : `${match[1]}__${file}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFileSize(value: unknown, maxFileBytes: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value > 0 && value <= maxFileBytes;
}

function emptyIndex(): PersistedIndex {
  return { version: INDEX_VERSION, accessSequence: 0, entries: [] };
}

function parseIndex(raw: string, maxFileBytes: number): PersistedIndex | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.version !== INDEX_VERSION ||
    !isSequence(value.accessSequence) || !Array.isArray(value.entries)) {
    return null;
  }
  const accessSequence = value.accessSequence;
  const seen = new Set<string>();
  const entries: PersistedEntry[] = [];
  for (const item of value.entries) {
    if (!isRecord(item) || typeof item.imagePath !== 'string' || seen.has(item.imagePath)) return null;
    const fileName = toCacheFileName(item.imagePath);
    if (fileName === null || item.fileName !== fileName ||
      !isFileSize(item.sizeBytes, maxFileBytes) || !isSequence(item.lastAccessSequence) ||
      item.lastAccessSequence > accessSequence) {
      return null;
    }
    seen.add(item.imagePath);
    entries.push({
      imagePath: item.imagePath,
      fileName,
      sizeBytes: item.sizeBytes,
      lastAccessSequence: item.lastAccessSequence,
    });
  }
  return { version: INDEX_VERSION, accessSequence, entries };
}

// Level 2: byte-budgeted LRU of encoded files under the app cache directory.
// Every mutation of the index or of the files runs through one serial queue,
// so concurrent loads cannot lose updates or corrupt the budget accounting.
export class DiskImageCache {
  private readonly queue = new SerialTaskQueue();
  // Iteration order == ascending lastAccessSequence: the first entry is the LRU victim.
  private readonly entries = new Map<string, DiskEntry>();
  private storedBytes = 0;
  private accessSequence = 0;
  private initialized = false;
  private partialCounter = 0;
  private touchesPending = false;
  private touchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly fileSystem: DiskCacheFileSystem,
    private readonly options: DiskImageCacheOptions,
  ) {}

  // Returns the local URI of a valid cached file and marks it most recently used.
  lookup(imagePath: string): Promise<string | null> {
    return this.exclusive(async () => {
      const entry = this.entries.get(imagePath);
      if (entry === undefined) return null;
      const size = this.fileSystem.fileSize(entry.fileName);
      if (size === null || size !== entry.sizeBytes ||
        !isFileSize(size, this.options.maxFileBytes)) {
        await this.removeEntry(imagePath, entry);
        return null;
      }
      this.touch(imagePath, entry);
      return this.fileSystem.uriOf(entry.fileName);
    });
  }

  // Each download writes to its own `.part` file, so an abandoned job that is
  // still unwinding can never delete or overwrite the partial of a newer job.
  preparePartial(imagePath: string): Promise<PartialDownloadTarget> {
    return this.exclusive(() => {
      const fileName = toCacheFileName(imagePath);
      if (fileName === null) throw new DiskCacheValidationError();
      this.partialCounter += 1;
      const name = `${fileName}.${this.partialCounter}.part`;
      return { name, uri: this.fileSystem.uriOf(name) };
    });
  }

  discardPartial(name: string): Promise<void> {
    return this.exclusive(() => {
      this.fileSystem.deleteFile(name);
    });
  }

  // Validates a finished partial and promotes it: `.part` → final file → index → eviction.
  commit(imagePath: string, partialName: string): Promise<string> {
    return this.exclusive(async () => {
      const fileName = toCacheFileName(imagePath);
      const size = this.fileSystem.fileSize(partialName);
      if (fileName === null || size === null || !isFileSize(size, this.options.maxFileBytes)) {
        this.fileSystem.deleteFile(partialName);
        throw new DiskCacheValidationError();
      }
      const previous = this.entries.get(imagePath);
      if (previous !== undefined) this.forget(imagePath, previous);
      await this.fileSystem.moveReplacing(partialName, fileName);
      this.accessSequence += 1;
      const entry: DiskEntry = { fileName, sizeBytes: size, lastAccessSequence: this.accessSequence };
      this.entries.set(imagePath, entry);
      this.storedBytes += size;
      this.evictOverBudget();
      try {
        await this.persist();
      } catch (error: unknown) {
        // Never report a cache entry that the persisted index does not know about.
        this.forget(imagePath, entry);
        this.fileSystem.deleteFile(fileName);
        throw error;
      }
      return this.fileSystem.uriOf(fileName);
    });
  }

  remove(imagePath: string): Promise<void> {
    return this.exclusive(async () => {
      const entry = this.entries.get(imagePath);
      if (entry !== undefined) {
        await this.removeEntry(imagePath, entry);
        return;
      }
      const fileName = toCacheFileName(imagePath);
      if (fileName !== null) this.fileSystem.deleteFile(fileName);
    });
  }

  // Diagnostic view (used by the harness); keys are listed LRU first.
  snapshot(): Promise<{ totalBytes: number; keys: string[] }> {
    return this.exclusive(() => ({ totalBytes: this.storedBytes, keys: [...this.entries.keys()] }));
  }

  private exclusive<T>(task: () => Promise<T> | T): Promise<T> {
    return this.queue.run(async () => {
      if (!this.initialized) {
        await this.initialize();
        this.initialized = true;
      }
      return task();
    });
  }

  private async initialize(): Promise<void> {
    this.entries.clear();
    this.storedBytes = 0;
    this.accessSequence = 0;
    this.fileSystem.ensureDirectory();

    let index: PersistedIndex | null;
    try {
      const raw = await this.fileSystem.readText(INDEX_FILE_NAME);
      index = raw === null ? emptyIndex() : parseIndex(raw, this.options.maxFileBytes);
    } catch {
      index = null;
    }
    if (index === null) {
      // Corrupt or incompatible state is not interpreted: wipe only our directory.
      this.fileSystem.resetDirectory();
      index = emptyIndex();
    }

    this.accessSequence = index.accessSequence;
    const ordered = [...index.entries].sort((a, b) => a.lastAccessSequence - b.lastAccessSequence);
    const knownNames = new Set([INDEX_FILE_NAME, ...ordered.map((entry) => entry.fileName)]);
    // Orphan `.part` files, stale temp files and anything unrecognized go away.
    for (const entry of this.fileSystem.listEntries()) {
      if (entry.isDirectory || !knownNames.has(entry.name)) this.fileSystem.deleteEntry(entry);
    }
    for (const entry of ordered) {
      const size = this.fileSystem.fileSize(entry.fileName);
      if (size !== entry.sizeBytes) {
        this.fileSystem.deleteFile(entry.fileName);
        continue;
      }
      this.entries.set(entry.imagePath, {
        fileName: entry.fileName,
        sizeBytes: entry.sizeBytes,
        lastAccessSequence: entry.lastAccessSequence,
      });
      this.storedBytes += entry.sizeBytes;
    }
    this.evictOverBudget();
    await this.persist();
  }

  private touch(imagePath: string, entry: DiskEntry): void {
    this.accessSequence += 1;
    this.entries.delete(imagePath);
    this.entries.set(imagePath, { ...entry, lastAccessSequence: this.accessSequence });
    // LRU order is updated in memory now; writing it is coalesced off the scroll path.
    this.touchesPending = true;
    if (this.touchTimer !== null) return;
    this.touchTimer = setTimeout(() => {
      this.touchTimer = null;
      void this.queue.run(async () => {
        if (this.touchesPending) await this.persist();
      }).catch(() => undefined);
    }, this.options.touchPersistDelayMs ?? DEFAULT_TOUCH_PERSIST_DELAY_MS);
  }

  private evictOverBudget(): void {
    while (this.storedBytes > this.options.budgetBytes) {
      const oldest = this.entries.entries().next();
      if (oldest.done) break;
      const [imagePath, entry] = oldest.value;
      this.forget(imagePath, entry);
      this.fileSystem.deleteFile(entry.fileName);
    }
  }

  private async removeEntry(imagePath: string, entry: DiskEntry): Promise<void> {
    this.forget(imagePath, entry);
    this.fileSystem.deleteFile(entry.fileName);
    await this.persist();
  }

  private forget(imagePath: string, entry: DiskEntry): void {
    this.entries.delete(imagePath);
    this.storedBytes -= entry.sizeBytes;
  }

  private async persist(): Promise<void> {
    const index: PersistedIndex = {
      version: INDEX_VERSION,
      accessSequence: this.accessSequence,
      entries: [...this.entries].map(([imagePath, entry]) => ({ imagePath, ...entry })),
    };
    await this.fileSystem.writeTextAtomically(INDEX_FILE_NAME, JSON.stringify(index));
    this.touchesPending = false;
  }
}
