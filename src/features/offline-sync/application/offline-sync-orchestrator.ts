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
  | 'foreground';

export interface OwnerReconciliationPublisher {
  markChanged(ownerUserId: string): number;
}

export interface MutationResolutionPublisher {
  publish(ownerUserId: string, events: readonly CompletedOfflineMutation[]): number;
}

// The single production entry point for drains. Triggers that arrive during an
// active run collapse into one trailing request. A blocked run never retries itself:
// another foreground/connectivity/owner/enqueue event is required.
export class OfflineSyncOrchestrator {
  private activeRequest: Promise<void> | null = null;
  private trailingRequested = false;
  private trailingAfterNonDrainedResult = false;

  constructor(
    private readonly processor: OfflineMutationDrainer,
    private readonly reconciliation: OwnerReconciliationPublisher,
    private readonly resolutions: MutationResolutionPublisher,
  ) {}

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

      if (!this.trailingRequested) return;
      if (result.kind !== 'drained' && !this.trailingAfterNonDrainedResult) return;
    }
  }
}
