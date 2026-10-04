import type { DirectMessage, DirectMessageReceiptKind } from '@/features/direct-messages/domain/direct-message';
import { compareDirectPositions } from '@/features/direct-messages/domain/direct-message-values';

// Live receipt watermarks over the OWNER's messages, from message-receipt hints. They
// sit beside the canonical DTOs and never rewrite them: the next HTTP read brings the
// real delivered_at/read_at. A watermark covers every own message at or before
// (throughCreatedAt, throughMessageId) in (createdAt, id) order.
export type ReceiptWatermark = { throughMessageId: string; throughCreatedAt: string; at: string };
export type ReceiptOverlay = { delivered: ReceiptWatermark | null; read: ReceiptWatermark | null };
export type OwnReceiptStatus = 'sent' | 'delivered' | 'read';

export const EMPTY_RECEIPT_OVERLAY: ReceiptOverlay = { delivered: null, read: null };

function covers(watermark: ReceiptWatermark | null, position: { createdAt: string; id: string }): boolean {
  if (watermark === null) return false;
  const order = compareDirectPositions(position, { createdAt: watermark.throughCreatedAt, id: watermark.throughMessageId });
  return order !== null && order >= 0;
}

// Forward only: an older or equal watermark (late or out-of-order hint) changes nothing
// and returns the same object.
export function advanceReceiptOverlay(overlay: ReceiptOverlay, event: {
  kind: DirectMessageReceiptKind; throughMessageId: string; throughCreatedAt: string; at: string;
}): ReceiptOverlay {
  const current = overlay[event.kind];
  if (covers(current, { createdAt: event.throughCreatedAt, id: event.throughMessageId })) return overlay;
  const next: ReceiptWatermark = { throughMessageId: event.throughMessageId, throughCreatedAt: event.throughCreatedAt, at: event.at };
  return { ...overlay, [event.kind]: next };
}

// Visto > Entregado > Enviado. Read implies delivered, so a read watermark (or a
// canonical read_at) wins whatever the delivered side says.
export function ownMessageReceiptStatus(message: DirectMessage, overlay: ReceiptOverlay): OwnReceiptStatus {
  if (message.readAt !== null || covers(overlay.read, message)) return 'read';
  if (message.deliveredAt !== null || covers(overlay.delivered, message)) return 'delivered';
  return 'sent';
}

export function receiptLabel(status: OwnReceiptStatus): string {
  return status === 'read' ? 'Visto' : status === 'delivered' ? 'Entregado' : 'Enviado';
}
