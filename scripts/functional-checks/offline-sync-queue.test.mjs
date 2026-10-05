import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Same resolution Metro gives the app: @/ alias and extensionless TypeScript imports.
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

// backend-api-client.ts builds its singleton at import time.
process.env.EXPO_PUBLIC_BACKEND_BASE_URL ??= 'https://backend.invalid';

const src = (file) => import(pathToFileURL(path.join(root, 'src/features/offline-sync', file)).href);
const { SQLiteOfflineMutationQueue } = await src('infrastructure/sqlite-offline-mutation-queue.ts');
const { prepareOfflineMutationDatabase } = await src('infrastructure/offline-mutation-database.ts');
const { OfflineMutationProcessor } = await src('application/offline-mutation-processor.ts');
const { OfflineSyncOrchestrator } = await src('application/offline-sync-orchestrator.ts');
const { OfflineSyncCoordinator, OFFLINE_SYNC_RETRY_DELAYS_MS } = await src('application/offline-sync-coordinator.ts');
const { OfflineMutationResolutionSignal } = await src('application/offline-mutation-resolution-signal.ts');
const { OwnerReconciliationSignal } = await src('application/owner-reconciliation-signal.ts');
const { runBackgroundOfflineSync } = await src('application/offline-sync-background.ts');
const { BackendPostLikeRemoteGateway } = await src('data/backend-post-like-remote-gateway.ts');
const { BackendPostCommentRemoteGateway } = await src('data/backend-post-comment-remote-gateway.ts');
const { BackendApiError } = await import(pathToFileURL(path.join(root, 'src/infrastructure/api/backend-api-client.ts')).href);
const { AuthenticatedUserMismatchError } = await import(
  pathToFileURL(path.join(root, 'src/infrastructure/api/authenticated-backend-api-client.ts')).href
);

const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const uuid = (digit) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const post1 = uuid('1');
const post2 = uuid('2');
const comment1 = uuid('3');
const reply1 = uuid('4');
const comment2 = uuid('5');

const settle = async () => {
  for (let index = 0; index < 50; index += 1) await new Promise((resolve) => setImmediate(resolve));
};

// expo-sqlite's async surface over Node's embedded SQLite (same engine, real file).
class NodeSqliteDatabase {
  constructor(file) { this.db = new DatabaseSync(file); }
  async execAsync(sql) { this.db.exec(sql); }
  async runAsync(sql, params = []) {
    const result = this.db.prepare(sql).run(...params);
    return { lastInsertRowId: Number(result.lastInsertRowid), changes: Number(result.changes) };
  }
  async getFirstAsync(sql, params = []) { return this.db.prepare(sql).get(...params) ?? null; }
  async getAllAsync(sql, params = []) { return this.db.prepare(sql).all(...params); }
  async withExclusiveTransactionAsync(task) {
    this.db.exec('BEGIN EXCLUSIVE');
    try {
      await task(this);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  async closeAsync() { if (this.db.isOpen) this.db.close(); }
}

// The remote contract of PUT /post-likes and POST /post-comments, with the same
// semantics as set_post_like / create_post_comment (desired state, client UUID).
class FakeBackend {
  session = userA;
  online = true;
  posts = new Set([post1, post2]);
  likes = new Map();
  comments = new Map();
  rejectedBodies = new Set();
  faults = [];
  applied = [];
  attempts = 0;
  inFlight = 0;
  maxInFlight = 0;

  putAsUser(owner, route, body) { return this.handle(owner, 'PUT', route, body); }
  postAsUser(owner, route, body) { return this.handle(owner, 'POST', route, body); }

  async handle(owner, method, route, body) {
    if (owner !== this.session) throw new AuthenticatedUserMismatchError();
    this.attempts += 1;
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      if (!this.online) throw new BackendApiError('offline', 'network');
      const fault = this.faults.shift();
      if (fault === 'network') throw new BackendApiError('reset', 'network');
      if (fault === 'captive-portal') throw new BackendApiError('html', 'invalid-json', 200);
      if (fault === 'server-error') throw new BackendApiError('boom', 'http', 500, 'post_like_update_failed');
      const response = method === 'PUT' ? this.setLike(owner, body) : this.createComment(owner, body);
      // Applied remotely, but the response never reaches the device.
      if (fault === 'lost-response') throw new BackendApiError('timeout', 'timeout');
      return response;
    } finally {
      this.inFlight -= 1;
    }
  }

  setLike(owner, { postId, liked }) {
    if (!this.posts.has(postId)) throw new BackendApiError('missing', 'http', 404, 'post_not_found');
    const users = this.likes.get(postId) ?? new Set();
    if (liked) users.add(owner); else users.delete(owner);
    this.likes.set(postId, users);
    this.applied.push(`${liked ? 'like' : 'unlike'}:${postId}`);
    return { like: { postId, liked: users.has(owner), likesCount: users.size } };
  }

  createComment(owner, { commentId, postId, parentCommentId, body }) {
    if (this.rejectedBodies.has(body)) {
      throw new BackendApiError('invalid', 'http', 400, 'invalid_post_comment_request');
    }
    if (!this.posts.has(postId)) throw new BackendApiError('missing', 'http', 404, 'post_not_found');
    if (parentCommentId !== null && this.comments.get(parentCommentId)?.postId !== postId) {
      throw new BackendApiError('missing', 'http', 404, 'parent_comment_not_found');
    }
    const existing = this.comments.get(commentId);
    if (existing && (existing.authorId !== owner || existing.body !== body ||
      existing.postId !== postId || existing.parentCommentId !== parentCommentId)) {
      throw new BackendApiError('conflict', 'http', 409, 'comment_creation_conflict');
    }
    const comment = existing ?? {
      id: commentId, postId, parentCommentId, authorId: owner, body, createdAt: '2026-10-04T12:00:00Z',
    };
    if (!existing) {
      this.comments.set(commentId, comment);
      this.applied.push(`comment:${commentId}`);
    }
    return { comment: { ...comment } };
  }
}

class FakeNetwork {
  state = { isConnected: true, isInternetReachable: true };
  listeners = new Set();
  fetch() { return Promise.resolve(this.state); }
  // Like NetInfo.addEventListener: the latest known state is delivered right away.
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }
  set(connected) {
    this.state = { isConnected: connected, isInternetReachable: connected };
    for (const listener of [...this.listeners]) listener(this.state);
  }
}

class FakeAppState {
  state = 'active';
  listeners = new Set();
  getCurrentState() { return this.state; }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  set(state) {
    this.state = state;
    for (const listener of [...this.listeners]) listener(state);
  }
}

class FakeTimers {
  now = 0;
  nextId = 1;
  tasks = new Map();
  setTimeout = (callback, delayMs) => {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  };
  clearTimeout = (id) => { this.tasks.delete(id); };
  pendingDelays() { return [...this.tasks.values()].map((task) => task.at - this.now); }
  async advance(ms) {
    const target = this.now + ms;
    for (;;) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      this.tasks.delete(due[0]);
      this.now = due[1].at;
      due[1].callback();
      await settle();
    }
    this.now = target;
    await settle();
  }
}

function createHarness({ dir = mkdtempSync(path.join(tmpdir(), 'offline-sync-')), backend = new FakeBackend() } = {}) {
  const file = path.join(dir, 'offline-mutations.db');
  const connections = [];
  const queue = new SQLiteOfflineMutationQueue(async () => {
    const connection = new NodeSqliteDatabase(file);
    connections.push(connection);
    return prepareOfflineMutationDatabase(connection);
  });
  const processor = new OfflineMutationProcessor(
    queue,
    { getCurrentUserId: async () => backend.session },
    new BackendPostLikeRemoteGateway(backend),
    new BackendPostCommentRemoteGateway(backend),
  );
  const resolutions = new OfflineMutationResolutionSignal();
  const reconciliation = new OwnerReconciliationSignal();
  const orchestrator = new OfflineSyncOrchestrator(processor, reconciliation, resolutions);
  const network = new FakeNetwork();
  const appState = new FakeAppState();
  const timers = new FakeTimers();
  const coordinator = new OfflineSyncCoordinator(network, appState, orchestrator, timers);
  const results = [];
  orchestrator.subscribe((result) => results.push(result));
  return {
    dir, backend, queue, orchestrator, resolutions, network, appState, timers, coordinator, results,
    close: async () => { for (const connection of connections) await connection.closeAsync(); },
    dispose: async () => {
      coordinator.stop();
      for (const connection of connections) await connection.closeAsync();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const like = (h, postId, liked, owner = userA) => h.queue.enqueueSetPostLike({ ownerUserId: owner, postId, liked });
const comment = (h, commentId, body, parentCommentId = null, postId = post1) => h.queue.enqueueCreatePostComment({
  ownerUserId: userA, commentId, postId, parentCommentId, body,
});
const pendingKinds = async (h, owner = userA) => (await h.queue.listPending(owner))
  .map((entry) => (entry.kind === 'set-post-like'
    ? `${entry.payload.liked ? 'like' : 'unlike'}:${entry.payload.postId}`
    : `comment:${entry.payload.commentId}`));

test('offline actions are stored in SQLite and survive closing the app', async () => {
  const h = createHarness();
  try {
    h.backend.online = false;
    await like(h, post1, true);
    await comment(h, comment1, 'hola');
    await like(h, post1, false);
    const blocked = await h.orchestrator.requestDrain('enqueue');
    void blocked;
    assert.equal(h.results.at(-1).kind, 'blocked');
    assert.equal(h.results.at(-1).reason, 'unavailable');
    assert.deepEqual(h.backend.applied, []);

    // Process death: the connection goes away and a new queue opens the same file.
    await h.close();
    const restarted = createHarness({ dir: h.dir, backend: h.backend });
    assert.deepEqual(await pendingKinds(restarted), [`like:${post1}`, `comment:${comment1}`, `unlike:${post1}`]);
    const sequences = (await restarted.queue.listPending(userA)).map((entry) => entry.sequence);
    assert.deepEqual(sequences, [...sequences].sort((left, right) => left - right));
    await restarted.dispose();
  } finally {
    await h.close();
  }
});

test('reconnecting replays every action once, in strict chronological order', async () => {
  const h = createHarness();
  try {
    h.coordinator.start();
    h.coordinator.setOwnerUserId(userA);
    await settle();
    h.network.set(false);
    h.backend.online = false;

    await like(h, post1, true);
    await comment(h, comment1, 'primero');
    await like(h, post2, true);
    await comment(h, reply1, 'respuesta', comment1);
    await like(h, post1, false);
    await comment(h, comment2, 'segundo');
    await h.orchestrator.requestDrain('enqueue');
    assert.deepEqual(h.backend.applied, []);
    // Offline, a timer could only fail again: the reconnection event drains instead.
    assert.deepEqual(h.timers.pendingDelays(), []);

    h.backend.online = true;
    h.network.set(true);
    await settle();

    assert.deepEqual(h.backend.applied, [
      `like:${post1}`, `comment:${comment1}`, `like:${post2}`, `comment:${reply1}`, `unlike:${post1}`, `comment:${comment2}`,
    ]);
    assert.equal(h.backend.maxInFlight, 1);
    assert.deepEqual(await pendingKinds(h), []);
    assert.equal(h.backend.likes.get(post1).has(userA), false);
    assert.equal(h.backend.likes.get(post2).has(userA), true);
    assert.equal(h.results.at(-1).kind, 'drained');
  } finally {
    await h.dispose();
  }
});

test('a failed first attempt after reconnecting is retried with backoff until it syncs', async () => {
  const h = createHarness();
  try {
    h.coordinator.start();
    h.coordinator.setOwnerUserId(userA);
    await settle();
    h.network.set(false);
    h.backend.online = false;
    await like(h, post1, true);
    await comment(h, comment1, 'hola');

    // The radio reports "connected" before the route really works.
    h.backend.online = true;
    h.backend.faults.push('network', 'captive-portal');
    h.network.set(true);
    await settle();
    assert.deepEqual(h.backend.applied, []);
    assert.deepEqual(h.timers.pendingDelays(), [OFFLINE_SYNC_RETRY_DELAYS_MS[0]]);

    await h.timers.advance(OFFLINE_SYNC_RETRY_DELAYS_MS[0]);
    assert.deepEqual(h.backend.applied, []);
    assert.deepEqual(h.timers.pendingDelays(), [OFFLINE_SYNC_RETRY_DELAYS_MS[1]]);

    await h.timers.advance(OFFLINE_SYNC_RETRY_DELAYS_MS[1]);
    assert.deepEqual(h.backend.applied, [`like:${post1}`, `comment:${comment1}`]);
    assert.deepEqual(await pendingKinds(h), []);
    assert.deepEqual(h.timers.pendingDelays(), []);
  } finally {
    await h.dispose();
  }
});

test('retries back off up to a cap and stop while offline or in background', async () => {
  const h = createHarness();
  try {
    h.coordinator.start();
    h.coordinator.setOwnerUserId(userA);
    await settle();
    await like(h, post1, true);
    h.backend.faults.push(...Array(20).fill('server-error'));
    await h.orchestrator.requestDrain('enqueue');

    const seen = [];
    for (let index = 0; index < OFFLINE_SYNC_RETRY_DELAYS_MS.length + 2; index += 1) {
      const [delay] = h.timers.pendingDelays();
      seen.push(delay);
      await h.timers.advance(delay);
    }
    const cap = OFFLINE_SYNC_RETRY_DELAYS_MS.at(-1);
    assert.deepEqual(seen, [...OFFLINE_SYNC_RETRY_DELAYS_MS, cap, cap]);
    assert.ok(seen.every((delay, index) => index === 0 || delay >= seen[index - 1]));

    h.network.set(false);
    assert.deepEqual(h.timers.pendingDelays(), []);
    h.backend.faults.length = 0;
    h.network.set(true);
    await settle();
    assert.deepEqual(h.backend.applied, [`like:${post1}`]);

    await like(h, post2, true);
    h.backend.faults.push('network');
    await h.orchestrator.requestDrain('enqueue');
    assert.equal(h.timers.pendingDelays().length, 1);
    h.appState.set('background');
    assert.deepEqual(h.timers.pendingDelays(), []);
    h.appState.set('active');
    await settle();
    assert.deepEqual(h.backend.applied, [`like:${post1}`, `like:${post2}`]);
  } finally {
    await h.dispose();
  }
});

test('a lost response is replayed without duplicating the comment or the like', async () => {
  const h = createHarness();
  try {
    await comment(h, comment1, 'una sola vez');
    await like(h, post1, true);
    h.backend.faults.push('lost-response');
    await h.orchestrator.requestDrain('enqueue');
    assert.equal(h.results.at(-1).kind, 'blocked');
    assert.deepEqual(await pendingKinds(h), [`comment:${comment1}`, `like:${post1}`]);

    h.backend.faults.push(undefined, 'lost-response');
    await h.orchestrator.requestDrain('connectivity-restored');
    await h.orchestrator.requestDrain('connectivity-restored');
    assert.equal(h.backend.comments.size, 1);
    assert.equal(h.backend.likes.get(post1).size, 1);
    assert.deepEqual(await pendingKinds(h), []);
  } finally {
    await h.dispose();
  }
});

test('state conflicts are resolved by the backend rules and never block later actions', async () => {
  const h = createHarness();
  try {
    // Another device liked post1; this device (offline) liked, then unliked it.
    h.backend.likes.set(post1, new Set([userB]));
    await like(h, post1, true);
    await like(h, post1, false);
    // post2 was deleted while offline.
    await like(h, post2, true);
    h.backend.posts.delete(post2);
    // A reply whose parent no longer exists, an id collision and a body the server refuses.
    await comment(h, reply1, 'respuesta', uuid('9'));
    h.backend.comments.set(comment1, {
      id: comment1, postId: post1, parentCommentId: null, authorId: userB, body: 'ajeno', createdAt: '2026-10-04T11:00:00Z',
    });
    await comment(h, comment1, 'mio');
    h.backend.rejectedBodies.add('rechazado');
    await comment(h, uuid('6'), 'rechazado');
    // Still delivered after all of the above.
    await comment(h, comment2, 'sigue llegando');

    await h.orchestrator.requestDrain('enqueue');

    assert.equal(h.results.at(-1).kind, 'drained');
    assert.deepEqual(await pendingKinds(h), []);
    assert.deepEqual([...h.backend.likes.get(post1)], [userB]);
    assert.equal(h.backend.likes.has(post2), false);
    // The colliding row of another author is untouched; nothing invalid was written.
    assert.equal(h.backend.comments.get(comment1).body, 'ajeno');
    assert.equal(h.backend.comments.has(reply1), false);
    assert.equal(h.backend.comments.has(uuid('6')), false);
    assert.equal(h.backend.comments.get(comment2).body, 'sigue llegando');

    const outcomes = Object.fromEntries(h.resolutions.getSnapshot(userA).events
      .filter((event) => event.kind === 'create-post-comment')
      .map((event) => [event.entityKey, event.outcome]));
    assert.deepEqual(outcomes, {
      [reply1]: 'parent-not-found',
      [comment1]: 'conflict',
      [uuid('6')]: 'rejected',
      [comment2]: 'confirmed',
    });
    const likeOutcomes = h.resolutions.getSnapshot(userA).events
      .filter((event) => event.kind === 'set-post-like').map((event) => event.outcome);
    assert.deepEqual(likeOutcomes, ['confirmed', 'confirmed', 'not-found']);
  } finally {
    await h.dispose();
  }
});

test('a local data problem stops the queue and is not retried in a loop', async () => {
  const h = createHarness();
  try {
    h.coordinator.start();
    h.coordinator.setOwnerUserId(userA);
    await settle();
    await like(h, post1, true);
    await like(h, post2, true);
    // Tampered row: it must never be skipped or deleted.
    const db = new DatabaseSync(path.join(h.dir, 'offline-mutations.db'));
    db.prepare('UPDATE offline_mutations SET payload_json = ? WHERE sequence = 1').run('{"broken":');
    db.close();
    await h.orchestrator.requestDrain('enqueue');
    assert.equal(h.results.at(-1).reason, 'corrupt-data');
    assert.deepEqual(h.timers.pendingDelays(), []);
    assert.deepEqual(h.backend.applied, []);
    assert.equal(await h.queue.count(userA), 2);
  } finally {
    await h.dispose();
  }
});

test('another account never sends or deletes the previous owner queue', async () => {
  const h = createHarness();
  try {
    h.backend.online = false;
    await like(h, post1, true);
    await h.orchestrator.requestDrain('enqueue');
    h.backend.online = true;
    h.backend.session = userB;
    await like(h, post2, true, userB);
    await h.orchestrator.requestDrain('owner-available');
    assert.deepEqual(h.backend.applied, [`like:${post2}`]);
    assert.deepEqual(await pendingKinds(h, userA), [`like:${post1}`]);
    h.backend.session = userA;
    await h.orchestrator.requestDrain('owner-available');
    assert.deepEqual(h.backend.applied, [`like:${post2}`, `like:${post1}`]);
  } finally {
    await h.dispose();
  }
});

// Manual test B: like + comment in airplane mode, close the app, reconnect, reopen.
async function closedOfflineSession() {
  const session = createHarness();
  session.backend.online = false;
  await like(session, post1, true);
  await comment(session, comment1, 'offline cerrado');
  await session.orchestrator.requestDrain('enqueue');
  await session.close();
  session.backend.online = true;
  return session;
}

const launchVariants = {
  'app active and online when the session is restored': async () => {},
  'Android reports background at JS start, then active': async (h) => { h.appState.state = 'background'; },
  'Wi-Fi still connecting at launch': async (h) => {
    h.network.state = { isConnected: false, isInternetReachable: null };
  },
  'first request after launch fails (route not ready)': async (h) => { h.backend.faults.push('network'); },
};

for (const [variant, prepare] of Object.entries(launchVariants)) {
  test(`reopening after closing offline syncs at launch: ${variant}`, async () => {
    const closed = await closedOfflineSession();
    const h = createHarness({ dir: closed.dir, backend: closed.backend });
    try {
      await prepare(h);
      // OfflineSyncCoordinatorHost: start on mount, owner once auth restores the session.
      h.coordinator.start();
      h.coordinator.setOwnerUserId(userA);
      await settle();
      if (h.appState.state !== 'active') h.appState.set('active');
      if (h.network.state.isConnected !== true) h.network.set(true);
      await settle();
      const [delay] = h.timers.pendingDelays();
      if (delay !== undefined) await h.timers.advance(delay);

      assert.deepEqual(h.backend.applied, [`like:${post1}`, `comment:${comment1}`]);
      assert.deepEqual(await pendingKinds(h), []);
      assert.equal(h.results.at(-1).kind, 'drained');
    } finally {
      await h.dispose();
    }
  });
}

test('the background task drains the queue while the app is not in the foreground', async () => {
  const h = createHarness();
  try {
    h.coordinator.start();
    h.coordinator.setOwnerUserId(userA);
    await settle();
    h.backend.online = false;
    await like(h, post1, true);
    await comment(h, comment1, 'desde segundo plano');
    await h.orchestrator.requestDrain('enqueue');
    h.appState.set('background');
    // A failed run in background schedules no foreground timer either.
    assert.equal(await runBackgroundOfflineSync(h.orchestrator), 'success');
    assert.equal(h.results.at(-1).reason, 'unavailable');
    assert.deepEqual(h.timers.pendingDelays(), []);
    h.backend.online = true;
    // Foreground triggers are paused in background: only the OS task runs now.
    h.network.set(false);
    h.network.set(true);
    await settle();
    assert.deepEqual(h.backend.applied, []);

    assert.equal(await runBackgroundOfflineSync(h.orchestrator), 'success');
    assert.deepEqual(h.backend.applied, [`like:${post1}`, `comment:${comment1}`]);
    assert.deepEqual(await pendingKinds(h), []);
  } finally {
    await h.dispose();
  }
});
