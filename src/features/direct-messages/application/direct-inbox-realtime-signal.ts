export type DirectInboxRealtimeListener = (version: number) => void;

// Owner-scoped "the inbox changed" signal fed by the global inbox subscription: one
// bump per valid message-created hint of THAT owner. Retained per owner, so an Inbox
// mounted later still starts from its own HTTP load; listeners of another owner never
// hear it.
export class DirectInboxRealtimeSignal {
  private readonly versions = new Map<string, number>();
  private readonly listeners = new Map<string, Set<DirectInboxRealtimeListener>>();

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

  subscribe(ownerUserId: string, listener: DirectInboxRealtimeListener): () => void {
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
