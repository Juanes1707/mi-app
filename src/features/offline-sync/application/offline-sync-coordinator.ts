import type {
  DrainBlockReason, OfflineMutationDrainResult,
} from '@/features/offline-sync/application/offline-mutation-processor';
import type {
  DrainResultListener, OfflineSyncTrigger,
} from '@/features/offline-sync/application/offline-sync-orchestrator';

export type ForegroundAppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';

export type RetryableNetworkState = {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
};

export interface NetworkStateMonitor {
  fetch(): Promise<RetryableNetworkState>;
  subscribe(listener: (state: RetryableNetworkState) => void): () => void;
}

export interface AppStateMonitor {
  getCurrentState(): ForegroundAppState | null;
  subscribe(listener: (state: ForegroundAppState) => void): () => void;
}

export interface OfflineDrainRequester {
  requestDrain(trigger: OfflineSyncTrigger): Promise<void>;
  subscribe(listener: DrainResultListener): () => void;
}

export interface RetryTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemTimers: RetryTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

// Exponential backoff with a cap: a link that is still settling right after a
// reconnection is retried within seconds, while a backend outage costs at most one
// request per minute and only while the app is in use.
export const OFFLINE_SYNC_RETRY_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000];

// Failures a later identical attempt can overcome: no route yet, server error,
// captive portal, a token being refreshed, the profile still being created. The
// others need a new fact (another session, an app update, a repaired database), so
// repeating the same request on a timer could never fix them.
const TRANSIENT_BLOCK_REASONS: ReadonlySet<DrainBlockReason> = new Set<DrainBlockReason>([
  'unavailable', 'invalid-response', 'authentication-required', 'profile-not-ready',
]);

export function isTransientDrainFailure(result: OfflineMutationDrainResult): boolean {
  return result.kind === 'blocked' && TRANSIENT_BLOCK_REASONS.has(result.reason);
}

function retryDelayMs(attempt: number): number {
  const delays = OFFLINE_SYNC_RETRY_DELAYS_MS;
  return delays[Math.min(attempt, delays.length - 1)] ?? 60_000;
}

export function isNetworkAttemptable(state: RetryableNetworkState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

// Global foreground coordinator. It drains on explicit lifecycle, owner and
// connectivity events, and after a transient failure it retries with backoff while
// the app is in use and the network is attemptable. There is no polling: a timer
// exists only between a failed drain and its retry. In background, the OS task
// (see offline-sync-background.ts) takes over.
export class OfflineSyncCoordinator {
  private ownerUserId: string | null = null;
  private appState: ForegroundAppState | null = null;
  private networkAttemptable: boolean | null = null;
  private unsubscribeNetwork: (() => void) | null = null;
  private unsubscribeAppState: (() => void) | null = null;
  private unsubscribeDrainResults: (() => void) | null = null;
  private lifecycle = 0;
  private retryAttempt = 0;
  private retryTimer: { handle: unknown } | null = null;

  constructor(
    private readonly network: NetworkStateMonitor,
    private readonly appStateMonitor: AppStateMonitor,
    private readonly orchestrator: OfflineDrainRequester,
    private readonly timers: RetryTimers = systemTimers,
  ) {}

  start(): void {
    if (this.unsubscribeNetwork !== null || this.unsubscribeAppState !== null) return;
    this.lifecycle += 1;
    this.appState = this.appStateMonitor.getCurrentState();
    this.unsubscribeDrainResults = this.orchestrator.subscribe(this.handleDrainResult);
    this.unsubscribeNetwork = this.network.subscribe(this.handleNetworkChange);
    this.unsubscribeAppState = this.appStateMonitor.subscribe(this.handleAppStateChange);
    if (this.ownerUserId !== null && this.appState === 'active') {
      void this.fetchNetworkAndRequestDrain('owner-available');
    }
  }

  stop(): void {
    this.lifecycle += 1;
    this.resetRetry();
    this.unsubscribeDrainResults?.();
    this.unsubscribeNetwork?.();
    this.unsubscribeAppState?.();
    this.unsubscribeDrainResults = null;
    this.unsubscribeNetwork = null;
    this.unsubscribeAppState = null;
    this.ownerUserId = null;
    this.appState = null;
    this.networkAttemptable = null;
  }

  setOwnerUserId(ownerUserId: string | null): void {
    if (ownerUserId === this.ownerUserId) return;
    this.ownerUserId = ownerUserId;
    // A pending retry belonged to the previous owner's queue.
    this.resetRetry();
    if (ownerUserId !== null && this.appState === 'active') {
      void this.fetchNetworkAndRequestDrain('owner-available');
    }
  }

  private readonly handleNetworkChange = (state: RetryableNetworkState): void => {
    const wasAttemptable = this.networkAttemptable;
    const isAttemptable = isNetworkAttemptable(state);
    this.networkAttemptable = isAttemptable;

    // Offline, a retry could only fail again; the reconnection below drains at once.
    if (!isAttemptable) {
      this.resetRetry();
      return;
    }
    if (wasAttemptable === false && this.ownerUserId !== null && this.appState === 'active') {
      this.resetRetry();
      void this.orchestrator.requestDrain('connectivity-restored');
    }
  };

  private readonly handleAppStateChange = (nextState: ForegroundAppState): void => {
    const previousState = this.appState;
    this.appState = nextState;
    // Retries run only while the app is in use (iOS 'inactive' is still visible).
    if (nextState !== 'active' && nextState !== 'inactive') this.resetRetry();
    if (
      nextState === 'active' &&
      this.ownerUserId !== null &&
      (previousState === 'background' || previousState === null || previousState === 'unknown')
    ) {
      const trigger = previousState === 'background' ? 'foreground' : 'owner-available';
      this.resetRetry();
      void this.fetchNetworkAndRequestDrain(trigger);
    }
  };

  // Every drain reports here, whoever requested it (enqueue, lifecycle, retry).
  private readonly handleDrainResult = (result: OfflineMutationDrainResult): void => {
    if (this.unsubscribeDrainResults === null) return;
    if (!isTransientDrainFailure(result)) {
      // Drained, signed out, another session, or a failure no retry can fix.
      this.resetRetry();
      return;
    }
    // Some entries went through, so the link works: the next failure starts over.
    if (result.processedCount > 0) this.retryAttempt = 0;
    const owner = this.ownerUserId?.toLowerCase() ?? null;
    if (result.ownerUserId !== null && result.ownerUserId !== owner) return;
    this.scheduleRetry();
  };

  private canRetry(): boolean {
    return this.ownerUserId !== null &&
      this.networkAttemptable !== false &&
      (this.appState === 'active' || this.appState === 'inactive');
  }

  // At most one timer: a failure reported while a retry is already waiting adds none.
  private scheduleRetry(): void {
    if (this.retryTimer !== null || !this.canRetry()) return;
    const delayMs = retryDelayMs(this.retryAttempt);
    this.retryAttempt += 1;
    const lifecycle = this.lifecycle;
    const timer: { handle: unknown } = { handle: null };
    this.retryTimer = timer;
    timer.handle = this.timers.setTimeout(() => {
      if (this.retryTimer !== timer) return;
      this.retryTimer = null;
      if (lifecycle !== this.lifecycle || !this.canRetry()) return;
      void this.orchestrator.requestDrain('retry');
    }, delayMs);
  }

  private resetRetry(): void {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer.handle);
    this.retryTimer = null;
    this.retryAttempt = 0;
  }

  private async fetchNetworkAndRequestDrain(trigger: OfflineSyncTrigger): Promise<void> {
    const lifecycle = this.lifecycle;
    try {
      const state = await this.network.fetch();
      if (lifecycle !== this.lifecycle || this.unsubscribeNetwork === null) return;
      const isAttemptable = isNetworkAttemptable(state);
      this.networkAttemptable = isAttemptable;
      if (isAttemptable && this.ownerUserId !== null && this.appState === 'active') {
        await this.orchestrator.requestDrain(trigger);
      }
    } catch {
      // A future event may try again.
    }
  }
}
