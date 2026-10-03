import type {
  OfflineSyncTrigger,
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
}

export function isNetworkAttemptable(state: RetryableNetworkState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

// Global foreground coordinator. It reacts only to explicit lifecycle, owner and
// connectivity events; there is no polling, retry timer or background worker.
export class OfflineSyncCoordinator {
  private ownerUserId: string | null = null;
  private appState: ForegroundAppState | null = null;
  private networkAttemptable: boolean | null = null;
  private unsubscribeNetwork: (() => void) | null = null;
  private unsubscribeAppState: (() => void) | null = null;
  private lifecycle = 0;

  constructor(
    private readonly network: NetworkStateMonitor,
    private readonly appStateMonitor: AppStateMonitor,
    private readonly orchestrator: OfflineDrainRequester,
  ) {}

  start(): void {
    if (this.unsubscribeNetwork !== null || this.unsubscribeAppState !== null) return;
    this.lifecycle += 1;
    this.appState = this.appStateMonitor.getCurrentState();
    this.unsubscribeNetwork = this.network.subscribe(this.handleNetworkChange);
    this.unsubscribeAppState = this.appStateMonitor.subscribe(this.handleAppStateChange);
    if (this.ownerUserId !== null && this.appState === 'active') {
      void this.fetchNetworkAndRequestDrain('owner-available');
    }
  }

  stop(): void {
    this.lifecycle += 1;
    this.unsubscribeNetwork?.();
    this.unsubscribeAppState?.();
    this.unsubscribeNetwork = null;
    this.unsubscribeAppState = null;
    this.ownerUserId = null;
    this.appState = null;
    this.networkAttemptable = null;
  }

  setOwnerUserId(ownerUserId: string | null): void {
    if (ownerUserId === this.ownerUserId) return;
    this.ownerUserId = ownerUserId;
    if (ownerUserId !== null && this.appState === 'active') {
      void this.fetchNetworkAndRequestDrain('owner-available');
    }
  }

  private readonly handleNetworkChange = (state: RetryableNetworkState): void => {
    const wasAttemptable = this.networkAttemptable;
    const isAttemptable = isNetworkAttemptable(state);
    this.networkAttemptable = isAttemptable;

    if (
      wasAttemptable === false &&
      isAttemptable &&
      this.ownerUserId !== null &&
      this.appState === 'active'
    ) {
      void this.orchestrator.requestDrain('connectivity-restored');
    }
  };

  private readonly handleAppStateChange = (nextState: ForegroundAppState): void => {
    const previousState = this.appState;
    this.appState = nextState;
    if (
      nextState === 'active' &&
      this.ownerUserId !== null &&
      (previousState === 'background' || previousState === null || previousState === 'unknown')
    ) {
      const trigger = previousState === 'background' ? 'foreground' : 'owner-available';
      void this.fetchNetworkAndRequestDrain(trigger);
    }
  };

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
      // A future event may try again. This coordinator never starts a retry loop.
    }
  }
}
