import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialPostMediaImageState,
  planPostMediaImageLoad,
  selectPostMediaImageViewState,
} from '../../src/features/post-media/presentation/post-media-image-state.ts';
import { LruMemoryImageCache } from '../../src/features/post-media/infrastructure/lru-memory-image-cache.ts';
import {
  MAX_DECODED_EDGE_PX, POST_MEDIA_MEMORY_BUDGET_BYTES,
} from '../../src/features/post-media/infrastructure/post-media-cache-limits.ts';
import { collectRetainedPostIds } from '../../src/features/feed/presentation/visible-post-ids.ts';

const VISIBLE = { isVisible: true, isRetained: true };
const NEAR = { isVisible: false, isRetained: true };
const FAR = { isVisible: false, isRetained: false };
const noCache = () => undefined;

test('a remounted row starts with its decoded RAM image and revalidates it', () => {
  const image = { nativeRef: 'cached-fixture' };
  assert.deepEqual(initialPostMediaImageState('author/post.png', image), {
    status: 'loaded',
    imagePath: 'author/post.png',
    image,
  });

  const validation = planPostMediaImageLoad(
    initialPostMediaImageState('author/post.png', image),
    'author/post.png',
    VISIBLE,
    noCache,
    true,
  );
  assert.equal(validation.state.status, 'loaded');
  assert.equal(validation.shouldRequest, true);
});

test('a loaded image survives crossing the visibility threshold next to the screen', () => {
  const image = { nativeRef: 'fixture' };
  const loaded = { status: 'loaded', imagePath: 'author/post.png', image };

  const near = planPostMediaImageLoad(loaded, loaded.imagePath, NEAR, noCache);
  assert.equal(near.shouldRequest, false);
  assert.equal(near.state, loaded);
  assert.equal(selectPostMediaImageViewState(near.state, loaded.imagePath, true), loaded);

  const visibleAgain = planPostMediaImageLoad(near.state, loaded.imagePath, VISIBLE, noCache);
  assert.equal(visibleAgain.shouldRequest, false);
  assert.equal(visibleAgain.state, loaded);
});

test('a row far from the screen drops its bitmap and never renders it', () => {
  const loaded = { status: 'loaded', imagePath: 'author/post.png', image: {} };
  const far = planPostMediaImageLoad(loaded, loaded.imagePath, FAR, () => ({ fromRam: true }));
  assert.equal(far.state.status, 'idle');
  assert.equal(far.shouldRequest, false);
  // Even before the effect commits, the render guard hides it.
  assert.equal(selectPostMediaImageViewState(loaded, loaded.imagePath, false).status, 'idle');
});

test('coming back next to the screen restores the RAM image, then revalidates it once visible', () => {
  const cached = { fromRam: true };
  const near = planPostMediaImageLoad({ status: 'idle' }, 'author/post.png', NEAR, () => cached);
  assert.deepEqual(near.state, { status: 'loaded', imagePath: 'author/post.png', image: cached });
  assert.equal(near.shouldRequest, false);
  assert.equal(near.needsRevalidation, true);

  const visible = planPostMediaImageLoad(near.state, 'author/post.png', VISIBLE, noCache, near.needsRevalidation);
  assert.equal(visible.state, near.state);
  assert.equal(visible.shouldRequest, true);
});

test('an unfinished request is not kept alive once the row stops being visible', () => {
  const loading = { status: 'loading', imagePath: 'author/post.png' };
  for (const viewport of [NEAR, FAR]) {
    const plan = planPostMediaImageLoad(loading, loading.imagePath, viewport, noCache);
    assert.equal(plan.shouldRequest, false);
    assert.equal(plan.state.status, 'idle');
  }
});

test('a recycled row requests its new image', () => {
  const previous = { status: 'loaded', imagePath: 'author/old.png', image: {} };
  const next = planPostMediaImageLoad(previous, 'author/new.png', VISIBLE, noCache);
  assert.equal(next.shouldRequest, true);
  assert.deepEqual(next.state, { status: 'loading', imagePath: 'author/new.png' });
});

test('retained rows are the visible range plus one neighbour on each side', () => {
  const posts = Array.from({ length: 6 }, (_, index) => ({ id: `p${index}` }));
  assert.deepEqual([...collectRetainedPostIds(posts, new Set(['p2', 'p3']), 1)], ['p1', 'p2', 'p3', 'p4']);
  assert.deepEqual([...collectRetainedPostIds(posts, new Set(['p0']), 1)], ['p0', 'p1']);
  assert.deepEqual([...collectRetainedPostIds(posts, new Set(['p5']), 1)], ['p4', 'p5']);
  assert.deepEqual([...collectRetainedPostIds(posts, new Set(), 1)], []);
});

// Worst case decode (square photo at the 1440 px cap), as the RAM LRU estimates it.
const IMAGE_BYTES = MAX_DECODED_EDGE_PX * MAX_DECODED_EDGE_PX * 4;
const VISIBLE_ROWS = 2;

// Mirrors usePostMediaImage + PostImageLoader for every MOUNTED row of the Feed while
// the viewport scrolls: real plan function, real retained-row rule, real LRU budget.
function simulateFeedScroll(postCount, mountedRowsPerSide, viewportTops) {
  const posts = Array.from({ length: postCount }, (_, index) => ({ id: `p${index}`, imagePath: `author/p${index}.jpg` }));
  const decoded = new Map();
  const lru = new LruMemoryImageCache(POST_MEDIA_MEMORY_BUDGET_BYTES, (image) => image.bytes);
  const rows = new Map();
  let decodes = 0;
  let flashes = 0;
  let maxRetainedBytes = 0;

  const acquire = (path) => {
    let image = lru.get(path);
    if (image === undefined) {
      decodes += 1;
      image = { path, bytes: IMAGE_BYTES };
      decoded.set(path, image);
    }
    lru.set(path, image);
    return image;
  };

  for (const top of viewportTops) {
    const visibleIds = new Set(posts.slice(top, top + VISIBLE_ROWS).map((post) => post.id));
    const retainedIds = collectRetainedPostIds(posts, visibleIds, 1);
    const first = Math.max(0, top - mountedRowsPerSide);
    const last = Math.min(postCount - 1, top + VISIBLE_ROWS - 1 + mountedRowsPerSide);
    for (const index of [...rows.keys()]) if (index < first || index > last) rows.delete(index);

    for (let index = first; index <= last; index += 1) {
      const { id, imagePath } = posts[index];
      const viewport = { isVisible: visibleIds.has(id), isRetained: retainedIds.has(id) };
      let row = rows.get(index);
      if (row === undefined) {
        const state = initialPostMediaImageState(imagePath, viewport.isRetained ? lru.get(imagePath) : undefined);
        row = { state, needsRevalidation: state.status === 'loaded' };
        rows.set(index, row);
      }
      const shownBefore = selectPostMediaImageViewState(row.state, imagePath, viewport.isRetained).status;
      const plan = planPostMediaImageLoad(row.state, imagePath, viewport, () => lru.get(imagePath), row.needsRevalidation);
      row.state = plan.state;
      row.needsRevalidation = plan.needsRevalidation;
      if (plan.shouldRequest) {
        row.state = { status: 'loaded', imagePath, image: acquire(imagePath) };
        row.needsRevalidation = false;
      }
      const shownAfter = selectPostMediaImageViewState(row.state, imagePath, viewport.isRetained).status;
      if (viewport.isRetained && shownBefore === 'loaded' && shownAfter !== 'loaded') flashes += 1;
    }

    // Distinct native bitmaps still referenced: by row state or by the RAM LRU.
    const alive = new Set(lru.keys().map((path) => decoded.get(path)));
    for (const row of rows.values()) if (row.state.status === 'loaded') alive.add(row.state.image);
    const bytes = [...alive].reduce((sum, image) => sum + image.bytes, 0);
    maxRetainedBytes = Math.max(maxRetainedBytes, bytes);
  }
  return { maxRetainedBytes, decodes, flashes };
}

const downAndBack = (count, stride = 1) => {
  const tops = [];
  for (let top = 0; top < count - VISIBLE_ROWS; top += stride) tops.push(top);
  for (let top = count - VISIBLE_ROWS; top >= 0; top -= stride) tops.push(top);
  return tops;
};

test('a long continuous scroll keeps decoded memory bounded, whatever the list length', () => {
  // FlatList windowSize 7 ≈ 3 screens per side ≈ 5 posts per side.
  const short = simulateFeedScroll(60, 5, downAndBack(60));
  const long = simulateFeedScroll(600, 5, downAndBack(600));
  const fling = simulateFeedScroll(600, 5, downAndBack(600, 5));
  // Even with FlatList's default 21-screen window the bitmaps stay bounded.
  const defaultWindow = simulateFeedScroll(600, 15, downAndBack(600));

  const bound = POST_MEDIA_MEMORY_BUDGET_BYTES + (VISIBLE_ROWS + 2) * IMAGE_BYTES;
  for (const run of [short, long, fling, defaultWindow]) {
    assert.ok(run.maxRetainedBytes <= bound, `${run.maxRetainedBytes} > ${bound}`);
    assert.equal(run.flashes, 0);
  }
  assert.equal(long.maxRetainedBytes, short.maxRetainedBytes);
  assert.equal(defaultWindow.maxRetainedBytes, long.maxRetainedBytes);
});

test('scrolling back shows recent posts from RAM; older ones come back from disk', () => {
  // p0..p4 decoded once. The 32 MiB LRU holds four 1440 px bitmaps (p1..p4), so
  // returning to p1 needs no decode, while p0 is decoded again from the disk cache.
  assert.equal(simulateFeedScroll(20, 5, [0, 1, 2, 3, 2, 1]).decodes, 5);
  assert.equal(simulateFeedScroll(20, 5, [0, 1, 2, 3, 2, 1, 0]).decodes, 6);
});
