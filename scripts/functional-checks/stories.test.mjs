import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

const stories = (file) => import(pathToFileURL(path.join(root, 'src/features/stories', file)).href);
const { StoryPlaybackController, StoryPressArbiter } = await stories('application/story-playback-controller.ts');
const { StorySeenTracker } = await stories('application/story-seen-tracker.ts');
const { SQLiteStorySeenStore } = await stories('data/sqlite-story-seen-store.ts');
const { prepareStoriesLocalDatabase } = await stories('data/stories-local-database.ts');
const { STORY_IMAGE_DURATION_MS } = await stories('domain/story-values.ts');

class FakeClock {
  now = 0;
  advance(ms) { this.now += ms; }
}

// Stands in for Reanimated: records what the bars are asked to draw.
class FakeAnimator {
  runs = [];
  held = [];
  run(from, durationMs, onComplete) { this.runs.push({ from, durationMs, onComplete }); }
  hold(at) { this.held.push(at); }
  finishLast() { this.runs.at(-1).onComplete(); }
}

test('each Story plays for 5 s once its image is displayed, then advances', () => {
  assert.equal(STORY_IMAGE_DURATION_MS, 5000);
  const clock = new FakeClock();
  const animator = new FakeAnimator();
  const finished = [];
  const playback = new StoryPlaybackController(animator, (key) => finished.push(key), () => clock.now);

  playback.setStory('story-1', false);
  assert.equal(playback.isRunning(), false, 'no progress while the image is still loading');
  playback.setStory('story-1', true);
  assert.equal(playback.isRunning(), true);
  assert.equal(animator.runs.at(-1).durationMs, 5000);

  animator.finishLast();
  assert.deepEqual(finished, ['story-1']);
});

test('holding pauses the progress and releasing resumes with the remaining time', () => {
  const clock = new FakeClock();
  const animator = new FakeAnimator();
  const finished = [];
  const playback = new StoryPlaybackController(animator, (key) => finished.push(key), () => clock.now);
  playback.setStory('story-1', true);

  clock.advance(2000);
  playback.pause('hold');
  assert.equal(playback.isRunning(), false);
  assert.equal(animator.held.at(-1), 0.4);

  // A completion of the paused run arriving late is ignored.
  animator.runs[0].onComplete();
  assert.deepEqual(finished, []);

  clock.advance(10_000);
  assert.equal(playback.progress(), 0.4, 'time held does not count');
  playback.resume('hold');
  assert.deepEqual({ from: animator.runs.at(-1).from, durationMs: animator.runs.at(-1).durationMs }, { from: 0.4, durationMs: 3000 });

  // Background and blur pause too, independently of the finger.
  playback.pause('background');
  playback.pause('hold');
  playback.resume('hold');
  assert.equal(playback.isRunning(), false);
  playback.resume('background');
  assert.equal(playback.isRunning(), true);
});

test('a long press never also navigates; a tap goes back on the left and forward on the right', () => {
  const calls = [];
  const arbiter = new StoryPressArbiter({
    onHoldStart: () => calls.push('hold-start'),
    onHoldEnd: () => calls.push('hold-end'),
    onPrevious: () => calls.push('previous'),
    onNext: () => calls.push('next'),
  });

  arbiter.pressBegan();
  arbiter.tapped(100, 400);
  arbiter.pressBegan();
  arbiter.tapped(300, 400);
  assert.deepEqual(calls, ['previous', 'next']);

  calls.length = 0;
  arbiter.pressBegan();
  arbiter.holdStarted();
  arbiter.tapped(300, 400);
  arbiter.holdFinished();
  assert.deepEqual(calls, ['hold-start', 'hold-end']);
});

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

const owner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const author = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'demo_alba', displayName: 'Alba', isPrivate: false };
const story = (digit, createdAt) => ({
  id: `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
  author,
  imagePath: `story-media/${author.id}/x.jpg`,
  createdAt,
  expiresAt: '2026-10-06T12:00:00Z',
});

test('"seen" is persisted locally and survives closing the app', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'stories-seen-'));
  const file = path.join(dir, 'stories-local.db');
  const connections = [];
  const openStore = () => new SQLiteStorySeenStore(async () => {
    const connection = new NodeSqliteDatabase(file);
    connections.push(connection);
    return prepareStoriesLocalDatabase(connection);
  });
  const now = () => Date.parse('2026-10-05T18:00:00Z');
  try {
    const first = story('1', '2026-10-05T12:00:00.000001Z');
    const second = story('2', '2026-10-05T12:30:00.000001Z');
    const tracker = new StorySeenTracker(openStore(), now);
    await tracker.ensureLoaded(owner);
    tracker.markSeen(owner, first);
    tracker.markSeen(owner, second);
    tracker.completeAuthor(owner, [first, second]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const connection of connections) await connection.closeAsync();

    // A new process: everything comes back from SQLite.
    const reopened = new StorySeenTracker(openStore(), now);
    await reopened.ensureLoaded(owner);
    assert.equal(reopened.isStorySeen(owner, first.id), true);
    assert.equal(reopened.isStorySeen(owner, second.id), true);
    const tray = { author, latestStoryCreatedAt: second.createdAt, activeStoryCount: 2 };
    assert.equal(reopened.isTrayFullySeen(owner, tray), true, 'the ring stays grey after a restart');
    // A newer Story makes the ring colourful again.
    assert.equal(reopened.isTrayFullySeen(owner, { ...tray, latestStoryCreatedAt: '2026-10-05T13:00:00.000001Z' }), false);
    // Another account on the same phone inherits nothing.
    const other = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await reopened.ensureLoaded(other);
    assert.equal(reopened.isStorySeen(other, first.id), false);
  } finally {
    for (const connection of connections) await connection.closeAsync();
    rmSync(dir, { recursive: true, force: true });
  }
});
