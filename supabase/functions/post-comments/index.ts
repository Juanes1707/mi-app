import { withSupabase } from 'npm:@supabase/server@1';

type PostCommentRequestValidation =
  | {
      ok: true;
      commentId: string;
      postId: string;
      parentCommentId: string | null;
      body: string;
    }
  | { ok: false; response: Response };

type PostCommentRpcStatus =
  | 'created'
  | 'already_created'
  | 'not_found'
  | 'parent_not_found'
  | 'profile_not_ready'
  | 'invalid_request'
  | 'comment_id_conflict';

type PostComment = {
  id: string;
  postId: string;
  parentCommentId: string | null;
  authorId: string;
  body: string;
  createdAt: string;
};

type PostCommentRpcResult =
  | { status: 'created' | 'already_created'; comment: PostComment }
  | {
      status:
        | 'not_found'
        | 'parent_not_found'
        | 'profile_not_ready'
        | 'invalid_request'
        | 'comment_id_conflict';
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRED_BODY_FIELDS = new Set([
  'commentId',
  'postId',
  'parentCommentId',
  'body',
]);
const POST_COMMENT_RPC_STATUSES = new Set<PostCommentRpcStatus>([
  'created',
  'already_created',
  'not_found',
  'parent_not_found',
  'profile_not_ready',
  'invalid_request',
  'comment_id_conflict',
]);
const RPC_RESULT_FIELDS = new Set([
  'status',
  'comment_id',
  'post_id',
  'parent_comment_id',
  'author_id',
  'body',
  'created_at',
]);
const TIMESTAMPTZ_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

function methodNotAllowedResponse(): Response {
  return Response.json(
    { code: 'method_not_allowed', message: 'Method not allowed.' },
    { status: 405, headers: { Allow: 'POST, OPTIONS' } },
  );
}

function invalidPostCommentRequestResponse(): Response {
  return errorResponse(
    400,
    'invalid_post_comment_request',
    'A valid post comment request is required.',
  );
}

function postNotFoundResponse(): Response {
  return errorResponse(404, 'post_not_found', 'Post not found.');
}

function parentCommentNotFoundResponse(): Response {
  return errorResponse(404, 'parent_comment_not_found', 'Parent comment not found.');
}

function profileNotReadyResponse(): Response {
  return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
}

function commentCreationConflictResponse(): Response {
  return errorResponse(
    409,
    'comment_creation_conflict',
    'Unable to create comment with this identifier.',
  );
}

function postCommentCreationFailedResponse(): Response {
  return errorResponse(
    500,
    'post_comment_creation_failed',
    'Unable to create post comment.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isSameUuid(value: unknown, expected: string): value is string {
  return isUuid(value) && value.toLowerCase() === expected.toLowerCase();
}

function isValidTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    TIMESTAMPTZ_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function hasOnlyNullData(row: Record<string, unknown>): boolean {
  return (
    row.comment_id === null &&
    row.post_id === null &&
    row.parent_comment_id === null &&
    row.author_id === null &&
    row.body === null &&
    row.created_at === null
  );
}

async function validatePostCommentRequest(
  request: Request,
): Promise<PostCommentRequestValidation> {
  let requestBody: unknown;

  try {
    requestBody = await request.json();
  } catch {
    return { ok: false, response: invalidPostCommentRequestResponse() };
  }

  if (!isRecord(requestBody)) {
    return { ok: false, response: invalidPostCommentRequestResponse() };
  }

  const fields = Object.keys(requestBody);
  const parentCommentId = requestBody.parentCommentId;
  const body = requestBody.body;

  if (
    fields.length !== REQUIRED_BODY_FIELDS.size ||
    fields.some((field) => !REQUIRED_BODY_FIELDS.has(field)) ||
    !isUuid(requestBody.commentId) ||
    !isUuid(requestBody.postId) ||
    (parentCommentId !== null && !isUuid(parentCommentId)) ||
    typeof body !== 'string' ||
    body.trim() === '' ||
    [...body].length > 500
  ) {
    return { ok: false, response: invalidPostCommentRequestResponse() };
  }

  return {
    ok: true,
    commentId: requestBody.commentId,
    postId: requestBody.postId,
    parentCommentId,
    body,
  };
}

function parsePostCommentRpcResult(
  value: unknown,
  actorId: string,
  request: Extract<PostCommentRequestValidation, { ok: true }>,
): PostCommentRpcResult | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }

  const row = value[0];
  const status = row.status;
  const fields = Object.keys(row);

  if (
    fields.length !== RPC_RESULT_FIELDS.size ||
    fields.some((field) => !RPC_RESULT_FIELDS.has(field)) ||
    typeof status !== 'string' ||
    !POST_COMMENT_RPC_STATUSES.has(status as PostCommentRpcStatus)
  ) {
    return null;
  }

  if (status !== 'created' && status !== 'already_created') {
    return hasOnlyNullData(row)
      ? { status: status as Exclude<PostCommentRpcStatus, 'created' | 'already_created'> }
      : null;
  }

  if (
    !isSameUuid(row.comment_id, request.commentId) ||
    !isSameUuid(row.post_id, request.postId) ||
    !isSameUuid(row.author_id, actorId) ||
    (request.parentCommentId === null
      ? row.parent_comment_id !== null
      : !isSameUuid(row.parent_comment_id, request.parentCommentId)) ||
    row.body !== request.body ||
    !isValidTimestamp(row.created_at)
  ) {
    return null;
  }

  return {
    status,
    comment: {
      id: row.comment_id,
      postId: row.post_id,
      parentCommentId: row.parent_comment_id as string | null,
      authorId: row.author_id,
      body: row.body,
      createdAt: row.created_at,
    },
  };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'POST') {
      return methodNotAllowedResponse();
    }

    const authenticatedUserId = context.userClaims?.id;

    if (!isUuid(authenticatedUserId)) {
      return errorResponse(401, 'unauthorized', 'Unauthorized.');
    }

    const validation = await validatePostCommentRequest(request);

    if (!validation.ok) {
      return validation.response;
    }

    const { data, error } = await context.supabaseAdmin.rpc('create_post_comment', {
      p_actor_id: authenticatedUserId,
      p_comment_id: validation.commentId,
      p_post_id: validation.postId,
      p_parent_comment_id: validation.parentCommentId,
      p_body: validation.body,
    });

    if (error) {
      console.error('create_post_comment RPC failed.');
      return postCommentCreationFailedResponse();
    }

    const result = parsePostCommentRpcResult(data, authenticatedUserId, validation);

    if (!result) {
      console.error('create_post_comment RPC returned an invalid result.');
      return postCommentCreationFailedResponse();
    }

    switch (result.status) {
      case 'created':
        return Response.json({ comment: result.comment }, { status: 201 });
      case 'already_created':
        return Response.json({ comment: result.comment });
      case 'not_found':
        return postNotFoundResponse();
      case 'parent_not_found':
        return parentCommentNotFoundResponse();
      case 'profile_not_ready':
        return profileNotReadyResponse();
      case 'invalid_request':
        return invalidPostCommentRequestResponse();
      case 'comment_id_conflict':
        return commentCreationConflictResponse();
      default:
        return postCommentCreationFailedResponse();
    }
  }),
};
