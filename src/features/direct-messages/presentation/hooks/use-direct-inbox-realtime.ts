import { useEffect, useRef } from 'react';

import {
  directInboxRealtimeSignal, directInboxRealtimeSource, directMessageReceipts,
} from '@/features/direct-messages/direct-messages-container';
import type { DirectInboxRealtimeSubscription } from '@/features/direct-messages/domain/direct-message-realtime';

// The global inbox link of the signed-in owner, alive on every screen while the app
// and Realtime are connected. Each valid message-created hint:
//   - bumps the owner's inbox signal (the Inbox refetches its first page over HTTP);
//   - when the PEER sent it, asks for "delivered" through that message (coalesced,
//     best effort). The owner's own messages are never acknowledged here.
// Owner change or sign-out closes the link; a late hint of a previous owner does
// nothing (closure + generation guard).
export function useDirectInboxRealtime(ownerUserId: string | null): void {
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    if (ownerUserId === null) return undefined;
    const owner = ownerUserId;
    let disposed = false;
    let subscription: DirectInboxRealtimeSubscription | null = null;
    const current = () => !disposed && generationRef.current === generation;

    directInboxRealtimeSource.subscribe({
      expectedOwnerUserId: owner,
      onMessageCreated: (event) => {
        if (!current()) return;
        directInboxRealtimeSignal.markChanged(owner);
        if (event.senderId !== owner) {
          directMessageReceipts.request(owner, event.conversationId,
            { messageId: event.messageId, createdAt: event.createdAt }, 'delivered');
        }
      },
    }).then(
      (joined) => {
        if (!current()) {
          void joined.unsubscribe();
          return;
        }
        subscription = joined;
      },
      () => {
        // Not joined (session mismatch, signed out, transport): HTTP keeps working;
        // the next owner change subscribes again. No retry timer.
      },
    );

    return () => {
      disposed = true;
      if (subscription !== null) void subscription.unsubscribe();
    };
  }, [ownerUserId]);
}
