import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialPostMediaImageState,
  planPostMediaImageLoad,
  selectPostMediaImageViewState,
} from '../../src/features/post-media/presentation/post-media-image-state.ts';

test('a remounted row starts with its decoded RAM image', () => {
  const image = { nativeRef: 'cached-fixture' };
  assert.deepEqual(initialPostMediaImageState('author/post.png', image), {
    status: 'loaded',
    imagePath: 'author/post.png',
    image,
  });

  const validation = planPostMediaImageLoad(
    initialPostMediaImageState('author/post.png', image),
    'author/post.png',
    true,
    true,
  );
  assert.equal(validation.state.status, 'loaded');
  assert.equal(validation.shouldRequest, true);
});

test('a loaded image survives leaving and re-entering the viewport', () => {
  const image = { nativeRef: 'fixture' };
  const loaded = { status: 'loaded', imagePath: 'author/post.png', image };

  const hidden = planPostMediaImageLoad(loaded, loaded.imagePath, false);
  assert.equal(hidden.shouldRequest, false);
  assert.equal(hidden.state, loaded);
  assert.equal(selectPostMediaImageViewState(hidden.state, loaded.imagePath), loaded);

  const visibleAgain = planPostMediaImageLoad(hidden.state, loaded.imagePath, true);
  assert.equal(visibleAgain.shouldRequest, false);
  assert.equal(visibleAgain.state, loaded);
});

test('an unfinished offscreen request is not kept alive', () => {
  const loading = { status: 'loading', imagePath: 'author/post.png' };
  const hidden = planPostMediaImageLoad(loading, loading.imagePath, false);
  assert.equal(hidden.shouldRequest, false);
  assert.equal(hidden.state.status, 'idle');
});

test('a recycled row requests its new image', () => {
  const previous = { status: 'loaded', imagePath: 'author/old.png', image: {} };
  const next = planPostMediaImageLoad(previous, 'author/new.png', true);
  assert.equal(next.shouldRequest, true);
  assert.deepEqual(next.state, { status: 'loading', imagePath: 'author/new.png' });
});
