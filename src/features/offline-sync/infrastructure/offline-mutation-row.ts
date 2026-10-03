import {
  CREATE_POST_COMMENT, SET_POST_LIKE, type QueuedCreatePostCommentMutation, type QueuedOfflineMutation,
  type QueuedSetPostLikeMutation,
} from '@/features/offline-sync/domain/offline-mutation';
import { OfflineSyncError } from '@/features/offline-sync/domain/offline-sync-error';
import { isValidPostCommentBody } from '@/features/offline-sync/domain/post-comment-body';
import { isCanonicalUuid } from '@/features/offline-sync/domain/uuid';

// payload_version is versioned per kind: a kind's payload can evolve without a
// schema migration, and an unknown version is never guessed at.
export const SET_POST_LIKE_PAYLOAD_VERSION = 1;
export const CREATE_POST_COMMENT_PAYLOAD_VERSION = 1;

export const MUTATION_COLUMNS =
  'sequence, owner_user_id, kind, entity_key, payload_version, payload_json, enqueued_at_ms';

const CREATE_POST_COMMENT_PAYLOAD_KEYS = ['commentId', 'postId', 'parentCommentId', 'body'];

type RowHeader = { sequence: number; ownerUserId: string; enqueuedAtMs: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function corrupt(): OfflineSyncError {
  return new OfflineSyncError('corrupt-data');
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

export function encodeSetPostLikePayload(postId: string, liked: boolean): string {
  return JSON.stringify({ postId, liked });
}

// Only what POST /post-comments needs. No author, token or ordering metadata: the
// author comes from the session token, the order from `sequence`.
export function encodeCreatePostCommentPayload(payload: QueuedCreatePostCommentMutation['payload']): string {
  return JSON.stringify({
    commentId: payload.commentId,
    postId: payload.postId,
    parentCommentId: payload.parentCommentId,
    body: payload.body,
  });
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw corrupt();
  }
  if (!isRecord(payload)) throw corrupt();
  return payload;
}

function decodeSetPostLike(
  header: RowHeader, entityKey: unknown, payloadVersion: unknown, payloadJson: string,
): QueuedSetPostLikeMutation {
  if (payloadVersion !== SET_POST_LIKE_PAYLOAD_VERSION || !isCanonicalUuid(entityKey)) throw corrupt();
  const payload = parsePayload(payloadJson);
  if (Object.keys(payload).length !== 2 ||
    !isCanonicalUuid(payload.postId) || typeof payload.liked !== 'boolean' ||
    payload.postId !== entityKey) {
    throw corrupt();
  }
  return {
    ...header,
    kind: SET_POST_LIKE,
    entityKey,
    payloadVersion: SET_POST_LIKE_PAYLOAD_VERSION,
    payload: { postId: payload.postId, liked: payload.liked },
  };
}

function decodeCreatePostComment(
  header: RowHeader, entityKey: unknown, payloadVersion: unknown, payloadJson: string,
): QueuedCreatePostCommentMutation {
  if (payloadVersion !== CREATE_POST_COMMENT_PAYLOAD_VERSION || !isCanonicalUuid(entityKey)) {
    throw corrupt();
  }
  const payload = parsePayload(payloadJson);
  const { commentId, postId, parentCommentId, body } = payload;
  if (!hasExactKeys(payload, CREATE_POST_COMMENT_PAYLOAD_KEYS) ||
    !isCanonicalUuid(commentId) || commentId !== entityKey ||
    !isCanonicalUuid(postId) ||
    !(parentCommentId === null || (isCanonicalUuid(parentCommentId) && parentCommentId !== commentId)) ||
    !isValidPostCommentBody(body)) {
    throw corrupt();
  }
  return {
    ...header,
    kind: CREATE_POST_COMMENT,
    entityKey,
    payloadVersion: CREATE_POST_COMMENT_PAYLOAD_VERSION,
    payload: { commentId, postId, parentCommentId, body },
  };
}

// Persisted rows may be old, tampered with or written by another code version.
// Anything that does not decode exactly is reported as corrupt-data: never
// skipped, never deleted, because dropping one entry would change the meaning
// of the history around it (like, [unlike], like) or lose a comment. That holds
// for an unknown kind or payload version too.
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
  const header: RowHeader = { sequence, ownerUserId, enqueuedAtMs };

  switch (kind) {
    case SET_POST_LIKE:
      return decodeSetPostLike(header, entityKey, payloadVersion, payloadJson);
    case CREATE_POST_COMMENT:
      return decodeCreatePostComment(header, entityKey, payloadVersion, payloadJson);
    default:
      throw corrupt();
  }
}
