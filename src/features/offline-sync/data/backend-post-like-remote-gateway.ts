import type {
  PostLikeRemoteGateway, SetPostLikeRemoteInput, SetPostLikeRemoteResult,
} from '@/features/offline-sync/domain/post-like-remote-gateway';
import { RemoteMutationError } from '@/features/offline-sync/domain/remote-mutation-error';
import { normalizeUuid } from '@/features/offline-sync/domain/uuid';
import {
  AuthenticatedBackendApiClient, AuthenticatedUserMismatchError, AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

// Exactly the backend contract: desired state, no identity, no ordering metadata.
type SetPostLikeRequestBody = { postId: string; liked: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSetPostLikeResponse(value: unknown, postId: string): SetPostLikeRemoteResult {
  if (!isRecord(value) || !isRecord(value.like)) throw new RemoteMutationError('invalid-response');
  const like = value.like;
  const likesCount = like.likesCount;
  if (normalizeUuid(like.postId) !== normalizeUuid(postId) || typeof like.liked !== 'boolean' ||
    typeof likesCount !== 'number' || !Number.isSafeInteger(likesCount) || likesCount < 0) {
    throw new RemoteMutationError('invalid-response');
  }
  return { kind: 'updated', postId, liked: like.liked, likesCount };
}

// Only the contract's own codes are outcomes. Anything else is a technical failure,
// so the queued entry is kept: e.g. a gateway 404 (function missing, wrong route) is
// `unavailable`, never `not-found`, because `not-found` deletes the entry.
function mapFailure(error: unknown, postId: string): SetPostLikeRemoteResult {
  if (error instanceof AuthenticatedUserMismatchError) {
    throw new RemoteMutationError('owner-session-mismatch');
  }
  if (error instanceof AuthenticationRequiredError) {
    throw new RemoteMutationError('authentication-required');
  }
  if (error instanceof BackendApiError) {
    if (error.status === 404 && error.backendCode === 'post_not_found') {
      return { kind: 'not-found', postId };
    }
    if (error.status === 409 && error.backendCode === 'profile_not_ready') {
      return { kind: 'profile-not-ready' };
    }
    if (error.status === 401) throw new RemoteMutationError('authentication-required');
    if (error.code === 'invalid-json') throw new RemoteMutationError('invalid-response');
    if (error.status === 400) throw new RemoteMutationError('invalid-request');
  }
  throw new RemoteMutationError('unavailable');
}

export class BackendPostLikeRemoteGateway implements PostLikeRemoteGateway {
  constructor(private readonly client: AuthenticatedBackendApiClient) {}

  async setLike({ expectedOwnerUserId, postId, liked }: SetPostLikeRemoteInput): Promise<SetPostLikeRemoteResult> {
    let response: unknown;
    try {
      // Bound to the queue owner: refused locally unless the session token is theirs.
      response = await this.client.putAsUser<unknown, SetPostLikeRequestBody>(
        expectedOwnerUserId, '/post-likes', { postId, liked },
      );
    } catch (error: unknown) {
      return mapFailure(error, postId);
    }
    return parseSetPostLikeResponse(response, postId);
  }
}
