import type { MarkDirectMessageReceipt } from '@/features/direct-messages/application/direct-message-use-cases';
import type { DirectMessageReceiptKind } from '@/features/direct-messages/domain/direct-message';
import {
  compareDirectPositions, isDirectTimestamp, normalizeDirectUuid,
} from '@/features/direct-messages/domain/direct-message-values';

// A receipt target: the newest PEER message the mark goes through. Only its order key
// matters here; the server re-resolves the id.
export type ReceiptTarget = { messageId: string; createdAt: string };

type Lane = {
  // Highest target the server confirmed, the one in flight, and ONE trailing target.
  acknowledged: ReceiptTarget | null;
  active: ReceiptTarget | null;
  pending: ReceiptTarget | null;
};

// (createdAt, id) order with microseconds and the UUID tiebreak.
function atOrBefore(target: ReceiptTarget, watermark: ReceiptTarget): boolean {
  const order = compareDirectPositions(
    { createdAt: target.createdAt, id: target.messageId }, { createdAt: watermark.createdAt, id: watermark.messageId },
  );
  return order !== null && order >= 0;
}
function newest(current: ReceiptTarget | null, candidate: ReceiptTarget): ReceiptTarget {
  return current !== null && atOrBefore(candidate, current) ? current : candidate;
}

// Coalesces delivered/read marks per (owner, conversation, kind): a burst M1, M2, M3
// costs one request for M1 and one trailing request for M3, never three in parallel.
// A mark already covered (confirmed, in flight or queued, or by a read for a delivered)
// costs nothing. Failures are not retried by any timer: the next hint, the next chat
// load or the next focus asks again. Requests are owner-bound; a late result of one
// owner only updates that owner's lane.
export class DirectMessageReceiptCoordinator {
  private readonly lanes = new Map<string, Lane>();

  constructor(private readonly markReceipt: MarkDirectMessageReceipt) {}

  request(ownerUserId: string, conversationId: string, target: ReceiptTarget, kind: DirectMessageReceiptKind): void {
    const owner = normalizeDirectUuid(ownerUserId);
    const conversation = normalizeDirectUuid(conversationId);
    const messageId = normalizeDirectUuid(target.messageId);
    if (owner === null || conversation === null || messageId === null || !isDirectTimestamp(target.createdAt) ||
        (kind !== 'delivered' && kind !== 'read')) return;
    const normalized: ReceiptTarget = { messageId, createdAt: target.createdAt };
    // Read implies delivered: a read at or after this point makes the delivered moot.
    if (kind === 'delivered' && this.covers(this.lane(owner, conversation, 'read'), normalized)) return;
    const lane = this.lane(owner, conversation, kind);
    if (this.covers(lane, normalized)) return;
    if (lane.active !== null) {
      lane.pending = normalized;
      return;
    }
    this.start(owner, conversation, kind, lane, normalized);
  }

  private lane(owner: string, conversation: string, kind: DirectMessageReceiptKind): Lane {
    const key = `${owner}|${conversation}|${kind}`;
    let lane = this.lanes.get(key);
    if (lane === undefined) {
      lane = { acknowledged: null, active: null, pending: null };
      this.lanes.set(key, lane);
    }
    return lane;
  }

  private covers(lane: Lane, target: ReceiptTarget): boolean {
    return [lane.acknowledged, lane.active, lane.pending].some((mark) => mark !== null && atOrBefore(target, mark));
  }

  private start(owner: string, conversation: string, kind: DirectMessageReceiptKind, lane: Lane, target: ReceiptTarget): void {
    lane.active = target;
    let request: Promise<unknown>;
    try {
      request = this.markReceipt.execute(owner, conversation, target.messageId, kind);
    } catch (error: unknown) {
      request = Promise.reject(error);
    }
    request.then(() => {
      lane.acknowledged = newest(lane.acknowledged, target);
      if (kind === 'read') {
        const delivered = this.lane(owner, conversation, 'delivered');
        delivered.acknowledged = newest(delivered.acknowledged, target);
      }
    }, () => undefined).finally(() => {
      lane.active = null;
      const next = lane.pending;
      lane.pending = null;
      if (next !== null && !(lane.acknowledged !== null && atOrBefore(next, lane.acknowledged))) {
        this.start(owner, conversation, kind, lane, next);
      }
    });
  }
}
