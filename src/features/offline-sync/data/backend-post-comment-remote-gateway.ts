import type {
  CreatePostCommentRemoteInput, CreatePostCommentRemoteResult, PostCommentRemoteGateway,
} from '@/features/offline-sync/domain/post-comment-remote-gateway';
import { RemoteMutationError } from '@/features/offline-sync/domain/remote-mutation-error';
import { normalizeUuid } from '@/features/offline-sync/domain/uuid';
import {
  AuthenticatedBackendApiClient, AuthenticatedUserMismatchError, AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

// Exactly the backend contract: no owner, actor, sequence or queue metadata.
type CreatePostCommentRequestBody = {
  commentId: string;
  postId: string;
  parentCommentId: string | null;
  body: string;
};

const RESPONSE_COMMENT_KEYS = ['id', 'postId', 'parentCommentId', 'authorId', 'body', 'createdAt'];
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1] &&
    Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59 &&
    Number(match[7] ?? 0) <= 23 && Number(match[8] ?? 0) <= 59;
}

const sameUuid = (value: unknown, expected: string) =>
  normalizeUuid(value) !== null && normalizeUuid(value) === normalizeUuid(expected);

// 201 (created) and 200 (exact replay) share this body. It must describe exactly the
// comment that was sent, authored by the queue owner: the backend takes the author
// from the token, so any other author means the request ran as someone else.
function parseCreatePostCommentResponse(
  value: unknown,
  input: CreatePostCommentRemoteInput,
): CreatePostCommentRemoteResult {
  if (!isRecord(value) || !hasExactKeys(value, ['comment']) || !isRecord(value.comment) ||
    !hasExactKeys(value.comment, RESPONSE_COMMENT_KEYS)) {
    throw new RemoteMutationError('invalid-response');
  }
  const { id, postId, parentCommentId, authorId, body, createdAt } = value.comment;
  if (!sameUuid(id, input.commentId) || !sameUuid(postId, input.postId) ||
    !(input.parentCommentId === null
      ? parentCommentId === null
      : sameUuid(parentCommentId, input.parentCommentId)) ||
    !sameUuid(authorId, input.expectedOwnerUserId) ||
    body !== input.body || !isTimestamp(createdAt)) {
    throw new RemoteMutationError('invalid-response');
  }
  return {
    kind: 'confirmed',
    comment: {
      id: input.commentId,
      postId: input.postId,
      parentCommentId: input.parentCommentId,
      authorId: input.expectedOwnerUserId,
      body: input.body,
      createdAt,
    },
  };
}

// Only the contract's own (status, code) pairs are outcomes. Anything else is a
// technical failure and the queued entry is kept: e.g. a gateway 404 (function
// missing, wrong route) is `unavailable`, never `post-not-found`, which deletes it.
function mapFailure(error: unknown): CreatePostCommentRemoteResult {
  if (error instanceof AuthenticatedUserMismatchError) {
    throw new RemoteMutationError('owner-session-mismatch');
  }
  if (error instanceof AuthenticationRequiredError) {
    throw new RemoteMutationError('authentication-required');
  }
  if (error instanceof BackendApiError) {
    if (error.code === 'invalid-json') throw new RemoteMutationError('invalid-response');
    if (error.code === 'http') {
      if (error.status === 404 && error.backendCode === 'post_not_found') {
        return { kind: 'post-not-found' };
      }
      if (error.status === 404 && error.backendCode === 'parent_comment_not_found') {
        return { kind: 'parent-not-found' };
      }
      if (error.status === 409 && error.backendCode === 'profile_not_ready') {
        return { kind: 'profile-not-ready' };
      }
      if (error.status === 409 && error.backendCode === 'comment_creation_conflict') {
        throw new RemoteMutationError('comment-conflict');
      }
      if (error.status === 401) throw new RemoteMutationError('authentication-required');
      if (error.status === 400) throw new RemoteMutationError('invalid-request');
    }
  }
  throw new RemoteMutationError('unavailable');
}

export class BackendPostCommentRemoteGateway implements PostCommentRemoteGateway {
  constructor(private readonly client: AuthenticatedBackendApiClient) {}

  async createComment(input: CreatePostCommentRemoteInput): Promise<CreatePostCommentRemoteResult> {
    const { expectedOwnerUserId, commentId, postId, parentCommentId, body } = input;
    let response: unknown;
    try {
      // Bound to the queue owner: refused locally unless the session token is theirs.
      response = await this.client.postAsUser<unknown, CreatePostCommentRequestBody>(
        expectedOwnerUserId, '/post-comments', { commentId, postId, parentCommentId, body },
      );
    } catch (error: unknown) {
      return mapFailure(error);
    }
    return parseCreatePostCommentResponse(response, input);
  }
}
