import { STORY_IMAGE_DURATION_MS } from '@/features/stories/domain/story-values';

// The visual progress driver (Reanimated in the app, a fake clock in tests). It only
// draws: the controller owns the timing decisions.
export interface StoryProgressAnimator {
  // Animate progress from `from` to 1 in `durationMs`, then call onComplete once.
  run(from: number, durationMs: number, onComplete: () => void): void;
  // Stop any animation and show exactly `at` (0..1).
  hold(at: number): void;
}

export type StoryPauseReason = 'hold' | 'blur' | 'background';

// Autoplay of one Story at a time. Progress runs only while the Story is READY (its
// image is displayed) and nothing pauses it (long press, screen blur, app not active).
// Pausing keeps the elapsed fraction; resuming continues with the REMAINING time.
export class StoryPlaybackController {
  private playKey: string | null = null;
  private ready = false;
  private readonly pauses = new Set<StoryPauseReason>();
  private fraction = 0;
  private running = false;
  private runStartedAt = 0;
  private runFrom = 0;
  private runToken = 0;
  private disposed = false;

  constructor(
    private readonly animator: StoryProgressAnimator,
    private readonly onFinished: (playKey: string) => void,
    private readonly now: () => number = Date.now,
    private readonly durationMs = STORY_IMAGE_DURATION_MS,
  ) {}

  // A new playKey (new Story, or the same one re-entered) always starts at 0.
  setStory(playKey: string | null, ready: boolean): void {
    if (this.disposed) return;
    if (playKey !== this.playKey) {
      this.stop();
      this.playKey = playKey;
      this.fraction = 0;
      this.animator.hold(0);
    }
    this.ready = playKey !== null && ready;
    this.reconcile();
  }

  pause(reason: StoryPauseReason): void {
    if (this.disposed) return;
    this.pauses.add(reason);
    this.reconcile();
  }

  resume(reason: StoryPauseReason): void {
    if (this.disposed) return;
    this.pauses.delete(reason);
    this.reconcile();
  }

  isRunning(): boolean { return this.running; }

  progress(): number {
    if (!this.running) return this.fraction;
    return Math.min(1, this.runFrom + (this.now() - this.runStartedAt) / this.durationMs);
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }

  private reconcile(): void {
    const shouldRun = this.playKey !== null && this.ready && this.pauses.size === 0 && this.fraction < 1;
    if (shouldRun && !this.running) this.start();
    else if (!shouldRun && this.running) this.stop();
  }

  private start(): void {
    const playKey = this.playKey;
    if (playKey === null) return;
    const token = ++this.runToken;
    this.running = true;
    this.runFrom = this.fraction;
    this.runStartedAt = this.now();
    const remaining = Math.max(0, (1 - this.fraction) * this.durationMs);
    this.animator.run(this.fraction, remaining, () => {
      // A completion of an older run (paused, replaced, disposed) is ignored.
      if (this.disposed || token !== this.runToken || playKey !== this.playKey || !this.running) return;
      this.running = false;
      this.fraction = 1;
      this.onFinished(playKey);
    });
  }

  private stop(): void {
    if (!this.running) return;
    this.fraction = this.progress();
    this.running = false;
    this.runToken += 1;
    this.animator.hold(this.fraction);
  }
}

// Tap vs long press on the Story surface. The gesture library already makes them
// exclusive; this guard also ignores a tap that ends a press that became a hold.
export class StoryPressArbiter {
  private holding = false;
  private heldThisPress = false;

  constructor(private readonly actions: {
    onHoldStart: () => void;
    onHoldEnd: () => void;
    onPrevious: () => void;
    onNext: () => void;
  }) {}

  pressBegan(): void {
    this.heldThisPress = false;
  }

  holdStarted(): void {
    if (this.holding) return;
    this.holding = true;
    this.heldThisPress = true;
    this.actions.onHoldStart();
  }

  // Called when the long-press gesture finalizes, whether or not it ever activated.
  holdFinished(): void {
    if (!this.holding) return;
    this.holding = false;
    this.actions.onHoldEnd();
  }

  tapped(x: number, width: number): void {
    if (this.heldThisPress || this.holding) return;
    if (x < width / 2) this.actions.onPrevious();
    else this.actions.onNext();
  }
}
