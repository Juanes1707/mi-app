export type OwnerReconciliationListener = (version: number) => void;

// A retained, owner-scoped signal. The version survives periods without subscribers,
// so a sync completed before the Feed mounts can still be observed later.
export class OwnerReconciliationSignal {
  private readonly versions = new Map<string, number>();
  private readonly listeners = new Map<string, Set<OwnerReconciliationListener>>();

  getVersion(ownerUserId: string): number {
    return this.versions.get(ownerUserId) ?? 0;
  }

  markChanged(ownerUserId: string): number {
    const version = this.getVersion(ownerUserId) + 1;
    this.versions.set(ownerUserId, version);
    const ownerListeners = this.listeners.get(ownerUserId);
    if (ownerListeners) {
      for (const listener of [...ownerListeners]) listener(version);
    }
    return version;
  }

  subscribe(ownerUserId: string, listener: OwnerReconciliationListener): () => void {
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
