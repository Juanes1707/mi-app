import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Node's type-stripping understands .ts, while Expo's extensionless imports and
// @/ alias need the same resolution they receive from Metro.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      return nextResolve(pathToFileURL(path.join(root, 'src', `${specifier.slice(2)}.ts`)).href, context);
    }
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !path.extname(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { LruMemoryImageCache, estimateDecodedBitmapBytes } = await import(
  '../../src/features/post-media/infrastructure/lru-memory-image-cache.ts'
);
const { DiskImageCache, DiskCacheValidationError } = await import(
  '../../src/features/post-media/infrastructure/disk-image-cache.ts'
);
const { PostImageLoader } = await import(
  '../../src/features/post-media/infrastructure/post-image-loader.ts'
);
const { PostMediaError } = await import(
  '../../src/features/post-media/domain/post-media-error.ts'
);
const limits = await import('../../src/features/post-media/infrastructure/post-media-cache-limits.ts');

const author = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const key = (digit) => `${author}/${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}.jpg`;

class MemoryFileSystem {
  files = new Map();

  ensureDirectory() {}
  resetDirectory() { this.files.clear(); }
  listEntries() { return [...this.files.keys()].map((name) => ({ name, isDirectory: false })); }
  deleteEntry(entry) { this.files.delete(entry.name); }
  readText(name) { return Promise.resolve(this.files.get(name)?.text ?? null); }
  writeTextAtomically(name, content) {
    this.files.set(name, { text: content, size: Buffer.byteLength(content) });
    return Promise.resolve();
  }
  fileSize(name) { return this.files.get(name)?.size ?? null; }
  moveReplacing(from, to) {
    const file = this.files.get(from);
    if (!file) throw new Error('missing partial');
    this.files.set(to, file);
    this.files.delete(from);
    return Promise.resolve();
  }
  deleteFile(name) { this.files.delete(name); }
  uriOf(name) { return `file:///cache/${name}`; }
  putPartial(name, size) { this.files.set(name, { size }); }
}

async function store(cache, fs, imagePath, size) {
  const partial = await cache.preparePartial(imagePath);
  fs.putPartial(partial.name, size);
  return cache.commit(imagePath, partial.name);
}

test('RAM cache counts decoded pixels and evicts the least recently used image', () => {
  assert.equal(estimateDecodedBitmapBytes({ width: 10, height: 20, scale: 2 }), 3200);
  assert.equal(limits.POST_MEDIA_MEMORY_BUDGET_BYTES, 32 * 1024 * 1024);

  const cache = new LruMemoryImageCache(12, (image) => image.bytes);
  for (const name of ['a', 'b', 'c']) assert.equal(cache.set(name, { bytes: 4 }), true);
  cache.get('a');
  cache.set('d', { bytes: 4 });
  assert.deepEqual(cache.keys(), ['c', 'a', 'd']);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.totalBytes, 12);
  assert.equal(cache.set('too-large', { bytes: 13 }), false);
  assert.equal(cache.totalBytes, 12);
});

test('disk cache evicts by access order and restores the LRU index after restart', async () => {
  assert.equal(limits.POST_MEDIA_DISK_BUDGET_BYTES, 128 * 1024 * 1024);
  const fs = new MemoryFileSystem();
  const options = { budgetBytes: 8, maxFileBytes: 6, touchPersistDelayMs: 0 };
  const cache = new DiskImageCache(fs, options);
  await store(cache, fs, key('1'), 4);
  await store(cache, fs, key('2'), 4);
  assert.ok(await cache.lookup(key('1')));
  await store(cache, fs, key('3'), 4);
  assert.deepEqual(await cache.snapshot(), { totalBytes: 8, keys: [key('1'), key('3')] });
  assert.equal(await cache.lookup(key('2')), null);

  const reopened = new DiskImageCache(fs, options);
  assert.deepEqual(await reopened.snapshot(), { totalBytes: 8, keys: [key('1'), key('3')] });
  assert.ok(await reopened.lookup(key('1')));
  await new Promise((resolve) => setTimeout(resolve, 10));
  const afterTouch = new DiskImageCache(fs, options);
  assert.deepEqual(await afterTouch.snapshot(), { totalBytes: 8, keys: [key('3'), key('1')] });
});

test('concurrent disk commits remain within one shared byte budget', async () => {
  const fs = new MemoryFileSystem();
  const cache = new DiskImageCache(fs, { budgetBytes: 8, maxFileBytes: 6 });
  const partials = await Promise.all(['6', '7', '8'].map(async (digit) => {
    const partial = await cache.preparePartial(key(digit));
    fs.putPartial(partial.name, 4);
    return { imagePath: key(digit), name: partial.name };
  }));
  await Promise.all(partials.map(({ imagePath, name }) => cache.commit(imagePath, name)));
  assert.deepEqual(await cache.snapshot(), { totalBytes: 8, keys: [key('7'), key('8')] });
  assert.equal(await cache.lookup(key('6')), null);
});

test('disk cache rejects an oversized partial without retaining it', async () => {
  const fs = new MemoryFileSystem();
  const cache = new DiskImageCache(fs, { budgetBytes: 8, maxFileBytes: 6 });
  const partial = await cache.preparePartial(key('4'));
  fs.putPartial(partial.name, 7);
  await assert.rejects(cache.commit(key('4'), partial.name), DiskCacheValidationError);
  assert.equal(fs.fileSize(partial.name), null);
  assert.deepEqual(await cache.snapshot(), { totalBytes: 0, keys: [] });
});

test('a RAM hit still requires authorization, and revoked access purges both levels', async () => {
  const imagePath = key('5');
  const image = { bytes: 4 };
  const memory = new LruMemoryImageCache(8, (value) => value.bytes);
  memory.set(imagePath, image);
  const events = [];
  let allowed = true;
  const loader = new PostImageLoader({
    authorizer: { execute: async () => {
      events.push('authorize');
      if (!allowed) throw new PostMediaError('not-found');
      return { signedUrl: 'unused' };
    } },
    memory: {
      get: (value) => { events.push('ram'); return memory.get(value); },
      set: (value, item) => memory.set(value, item),
      delete: (value) => { events.push('purge-ram'); memory.delete(value); },
    },
    disk: {
      lookup: async () => { throw new Error('RAM hit should skip disk'); },
      preparePartial: async () => { throw new Error('RAM hit should skip download'); },
      discardPartial: async () => {},
      commit: async () => { throw new Error('RAM hit should skip download'); },
      remove: async () => { events.push('purge-disk'); },
    },
    downloader: { download: async () => { throw new Error('RAM hit should skip network'); } },
    decoder: {
      decode: async () => { throw new Error('RAM hit should skip decode'); },
      purgeInternalCaches: async () => { events.push('purge-native'); },
    },
  });

  assert.deepEqual(await loader.request(imagePath).result, { status: 'loaded', image });
  assert.deepEqual(events, ['authorize', 'ram']);
  allowed = false;
  const revoked = await loader.request(imagePath).result;
  assert.equal(revoked.status, 'failed');
  assert.equal(revoked.error.code, 'not-found');
  assert.deepEqual(events.slice(2), ['authorize', 'purge-ram', 'purge-disk', 'purge-native']);
  assert.equal(memory.get(imagePath), undefined);
});
