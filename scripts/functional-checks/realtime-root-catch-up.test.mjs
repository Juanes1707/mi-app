import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldCatchUpRealtimeRoot,
} from '../../src/features/comments/presentation/realtime-root-catch-up.ts';

test('catches up once when the root finishes loading after the realtime subscription', () => {
  assert.equal(shouldCatchUpRealtimeRoot(1, 0, false), false);
  assert.equal(shouldCatchUpRealtimeRoot(1, 0, true), true);
  assert.equal(shouldCatchUpRealtimeRoot(1, 1, true), false);
});

test('catches up again after a later reconnection', () => {
  assert.equal(shouldCatchUpRealtimeRoot(2, 1, true), true);
});
