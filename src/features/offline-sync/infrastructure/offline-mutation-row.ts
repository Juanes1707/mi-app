import { SET_POST_LIKE, type QueuedOfflineMutation } from '@/features/offline-sync/domain/offline-mutation';
import { OfflineSyncError } from '@/features/offline-sync/domain/offline-sync-error';
import { isCanonicalUuid } from '@/features/offline-sync/domain/uuid';

export const SET_POST_LIKE_PAYLOAD_VERSION = 1;

export const MUTATION_COLUMNS =
  'sequence, owner_user_id, kind, entity_key, payload_version, payload_json, enqueued_at_ms';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function corrupt(): OfflineSyncError {
  return new OfflineSyncError('corrupt-data');
}

export function encodeSetPostLikePayload(postId: string, liked: boolean): string {
  return JSON.stringify({ postId, liked });
}

// Persisted rows may be old, tampered with or written by another code version.
// Anything that does not decode exactly is reported as corrupt-data: never
// skipped, never deleted, because dropping one entry would change the meaning
// of the history around it (like, [unlike], like).
export function decodeOfflineMutationRow(row: unknown): QueuedOfflineMutation {
  if (!isRecord(row)) throw corrupt();
  const {
    sequence, owner_user_id: ownerUserId, kind, entity_key: entityKey,
    payload_version: payloadVersion, payload_json: payloadJson, enqueued_at_ms: enqueuedAtMs,
  } = row;
  if (!isSafeInteger(sequence, 1) || !isCanonicalUuid(ownerUserId) ||
    !isSafeInteger(enqueuedAtMs, 0) || typeof payloadJson !== 'string') {
    throw corrupt();
  }

  if (kind !== SET_POST_LIKE) throw corrupt();
  if (payloadVersion !== SET_POST_LIKE_PAYLOAD_VERSION || !isCanonicalUuid(entityKey)) throw corrupt();

  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw corrupt();
  }
  if (!isRecord(payload) || Object.keys(payload).length !== 2 ||
    !isCanonicalUuid(payload.postId) || typeof payload.liked !== 'boolean' ||
    payload.postId !== entityKey) {
    throw corrupt();
  }

  return {
    sequence,
    ownerUserId,
    kind: SET_POST_LIKE,
    entityKey,
    payloadVersion: SET_POST_LIKE_PAYLOAD_VERSION,
    enqueuedAtMs,
    payload: { postId: payload.postId, liked: payload.liked },
  };
}
