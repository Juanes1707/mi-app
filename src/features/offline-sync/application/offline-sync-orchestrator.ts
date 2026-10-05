import type {
  OfflineMutationDrainResult,
} from '@/features/offline-sync/application/offline-mutation-processor';
import type { CompletedOfflineMutation } from '@/features/offline-sync/domain/offline-mutation-resolution';

export interface OfflineMutationDrainer {
  drainCurrentUser(): Promise<OfflineMutationDrainResult>;
}

export type OfflineSyncTrigger =
  | 'enqueue'
  | 'owner-available'
  | 'connectivity-restored'
  | 'foreground'
  // Backoff timer after a transient failure (see OfflineSyncCoordinator).
  | 'retry'
  // The OS ran the background sync task (app in background or not visible).
  | 'background-task';

export type DrainResultListener = (result: OfflineMutationDrainResult) => void;

export interface OwnerReconciliationPublisher {
  markChanged(ownerUserId: string): number;
}

export interface MutationResolutionPublisher {
  publish(ownerUserId: string, events: readonly CompletedOfflineMutation[]): number;
}

// The single production entry point for drains. Triggers that arrive during an
// active run collapse into one trailing request. A blocked run never retries itself:
// it reports its result, and the coordinator decides whether a retry is worth it.
export class OfflineSyncOrchestrator {
  private activeRequest: Promise<void> | null = null;
  private trailingRequested = false;
  private trailingAfterNonDrainedResult = false;
  private readonly listeners = new Set<DrainResultListener>();

  constructor(
    private readonly processor: OfflineMutationDrainer,
    private readonly reconciliation: OwnerReconciliationPublisher,
    private readonly resolutions: MutationResolutionPublisher,
  ) {}

  // Every processor run is reported, whoever requested it (an enqueue too), so a
  // transient failure can be retried even if no lifecycle event follows it.
  subscribe(listener: DrainResultListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  requestDrain(trigger: OfflineSyncTrigger): Promise<void> {
    if (this.activeRequest !== null) {
      this.trailingRequested = true;
      if (trigger !== 'enqueue') this.trailingAfterNonDrainedResult = true;
      return this.activeRequest;
    }

    const request = this.runRequestedDrains().finally(() => {
      if (this.activeRequest === request) this.activeRequest = null;
    });
    this.activeRequest = request;
    return request;
  }

  private async runRequestedDrains(): Promise<void> {
    for (;;) {
      this.trailingRequested = false;
      this.trailingAfterNonDrainedResult = false;

      let result: OfflineMutationDrainResult;
      try {
        result = await this.processor.drainCurrentUser();
      } catch {
        return;
      }

      // The owner is the one the processor drained, captured by it: never the session
      // at this moment. Details first, then the general invalidation, so whoever reacts
      // to the reconciliation can already look up how each mutation ended.
      if (result.ownerUserId !== null && result.completedMutations.length > 0) {
        this.resolutions.publish(result.ownerUserId, result.completedMutations);
        this.reconciliation.markChanged(result.ownerUserId);
      }
      for (const listener of [...this.listeners]) {
        // One failing consumer must not stop the others (nor the drain loop).
        try {
          listener(result);
        } catch {
          // Ignored on purpose.
        }
      }

      if (!this.trailingRequested) return;
      if (result.kind !== 'drained' && !this.trailingAfterNonDrainedResult) return;
    }
  }
}
