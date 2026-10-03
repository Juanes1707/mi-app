import type { CompletedOfflineMutation } from '@/features/offline-sync/domain/offline-mutation-resolution';

export type MutationResolutionSnapshot = {
  // +1 per published batch of this owner; never decreases while the app runs.
  version: number;
  // This owner's most recent resolutions, oldest first, at most the history limit.
  events: readonly CompletedOfflineMutation[];
};

export type MutationResolutionListener = (snapshot: MutationResolutionSnapshot) => void;

// A screen reconciles right after the drain that resolved its mutations, so it only
// needs the recent past; 256 covers many drains of a busy session while keeping the
// memory per signed-in owner small and fixed.
export const DEFAULT_RESOLUTION_HISTORY = 256;

const EMPTY_SNAPSHOT: MutationResolutionSnapshot = Object.freeze({ version: 0, events: Object.freeze([]) });

// Only the identity of the entry and its outcome travel: never a body or a token,
// even if a caller passes a richer object.
function minimal(event: CompletedOfflineMutation): CompletedOfflineMutation {
  return event.kind === 'set-post-like'
    ? { sequence: event.sequence, ownerUserId: event.ownerUserId, kind: event.kind, entityKey: event.entityKey, outcome: event.outcome }
    : { sequence: event.sequence, ownerUserId: event.ownerUserId, kind: event.kind, entityKey: event.entityKey, outcome: event.outcome };
}

// How recently finished queue entries ended, per owner, in memory only. Unlike
// OwnerReconciliationSignal ("something changed"), it says WHICH entry finished and
// HOW. It is retained, not fire-and-forget: a consumer that reads after a publish
// (e.g. on the reconciliation that follows it) still finds the resolution.
export class OfflineMutationResolutionSignal {
  private readonly snapshots = new Map<string, MutationResolutionSnapshot>();
  private readonly listeners = new Map<string, Set<MutationResolutionListener>>();

  constructor(private readonly historyLimit = DEFAULT_RESOLUTION_HISTORY) {
    if (!Number.isSafeInteger(historyLimit) || historyLimit < 1) {
      throw new Error('The resolution history limit must be a positive integer.');
    }
  }

  getSnapshot(ownerUserId: string): MutationResolutionSnapshot {
    return this.snapshots.get(ownerUserId) ?? EMPTY_SNAPSHOT;
  }

  // The latest resolution of one entry of this owner, while it is in the window.
  find(
    ownerUserId: string,
    kind: CompletedOfflineMutation['kind'],
    entityKey: string,
  ): CompletedOfflineMutation | null {
    const { events } = this.getSnapshot(ownerUserId);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event !== undefined && event.kind === kind && event.entityKey === entityKey) return event;
    }
    return null;
  }

  // Appends one drain's resolutions for this owner (events of any other owner are
  // ignored) and returns the owner's version.
  publish(ownerUserId: string, events: readonly CompletedOfflineMutation[]): number {
    const own = events.filter((event) => event.ownerUserId === ownerUserId).map(minimal);
    const previous = this.getSnapshot(ownerUserId);
    if (own.length === 0) return previous.version;

    const snapshot: MutationResolutionSnapshot = Object.freeze({
      version: previous.version + 1,
      events: Object.freeze([...previous.events, ...own].slice(-this.historyLimit)),
    });
    this.snapshots.set(ownerUserId, snapshot);
    for (const listener of [...(this.listeners.get(ownerUserId) ?? [])]) {
      // One failing consumer must not stop the others (nor the publisher).
      try {
        listener(snapshot);
      } catch {
        // Ignored on purpose.
      }
    }
    return snapshot.version;
  }

  subscribe(ownerUserId: string, listener: MutationResolutionListener): () => void {
    let ownerListeners = this.listeners.get(ownerUserId);
    if (!ownerListeners) {
      ownerListeners = new Set();
      this.listeners.set(ownerUserId, ownerListeners);
    }
    ownerListeners.add(listener);
    return () => {
      ownerListeners?.delete(listener);
      if (ownerListeners?.size === 0) this.listeners.delete(ownerUserId);
    };
  }
}
