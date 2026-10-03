import { withSupabase } from 'npm:@supabase/server@1';

// GET /post-comment?postId=<uuid>&commentId=<uuid>
// One comment through the same read model as GET /post-comments. It is the
// authorized read behind every Realtime invalidation: a Broadcast only carries ids,
// so the content is always re-authorized here before it reaches a screen.

type PostComment = {
  id: string;
  postId: string;
  parentCommentId: string | null;
  author: {
    id: string;
    username: string | null;
    displayName: string | null;
  };
  body: string;
  createdAt: string;
  directRepliesCount: number;
};

type GetPostCommentRequestValidation =
  | { ok: true; postId: string; commentId: string }
  | { ok: false; response: Response };

type GetPostCommentRpcStatus =
  | 'ok'
  | 'not_found'
  | 'comment_not_found'
  | 'profile_not_ready'
  | 'invalid_request';

type GetPostCommentRpcResult =
  | { status: 'ok'; comment: PostComment }
  | { status: Exclude<GetPostCommentRpcStatus, 'ok'> };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const ALLOWED_QUERY_FIELDS = new Set(['postId', 'commentId']);
const RPC_STATUSES = new Set<GetPostCommentRpcStatus>([
  'ok',
  'not_found',
  'comment_not_found',
  'profile_not_ready',
  'invalid_request',
]);
const RPC_RESULT_FIELDS = new Set([
  'status',
  'comment_id',
  'post_id',
  'parent_comment_id',
  'body',
  'created_at',
  'author_id',
  'author_username',
  'author_display_name',
  'direct_replies_count',
]);

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

function methodNotAllowedResponse(): Response {
  return Response.json(
    { code: 'method_not_allowed', message: 'Method not allowed.' },
    { status: 405, headers: { Allow: 'GET, OPTIONS' } },
  );
}

function invalidRequestResponse(): Response {
  return errorResponse(400, 'invalid_post_comment_request', 'A valid post comment request is required.');
}

function postNotFoundResponse(): Response {
  return errorResponse(404, 'post_not_found', 'Post not found.');
}

function commentNotFoundResponse(): Response {
  return errorResponse(404, 'post_comment_not_found', 'Comment not found.');
}

function profileNotReadyResponse(): Response {
  return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
}

function readFailedResponse(): Response {
  return errorResponse(500, 'post_comment_read_failed', 'Unable to load post comment.');
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

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = ISO_TIMESTAMP_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    Number(match[4]) <= 23 &&
    Number(match[5]) <= 59 &&
    Number(match[6]) <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function hasExactFields(row: Record<string, unknown>, expected: Set<string>): boolean {
  const fields = Object.keys(row);
  return fields.length === expected.size && fields.every((field) => expected.has(field));
}

function hasOnlyNullData(row: Record<string, unknown>): boolean {
  return [...RPC_RESULT_FIELDS].every((field) => field === 'status' || row[field] === null);
}

// Exactly postId and commentId, once each: no extras, no duplicates.
function validateRequest(request: Request): GetPostCommentRequestValidation {
  const url = new URL(request.url);
  const fields = [...url.searchParams.keys()];
  const postIdValues = url.searchParams.getAll('postId');
  const commentIdValues = url.searchParams.getAll('commentId');
  const postId = postIdValues[0];
  const commentId = commentIdValues[0];

  if (
    fields.some((field) => !ALLOWED_QUERY_FIELDS.has(field)) ||
    postIdValues.length !== 1 ||
    commentIdValues.length !== 1 ||
    !isUuid(postId) ||
    !isUuid(commentId)
  ) {
    return { ok: false, response: invalidRequestResponse() };
  }

  return { ok: true, postId, commentId };
}

function parseRpcResult(
  value: unknown,
  request: Extract<GetPostCommentRequestValidation, { ok: true }>,
): GetPostCommentRpcResult | null {
  if (!Array.isArray(value) || value.length !== 1) {
    return null;
  }

  const row: unknown = value[0];

  if (!isRecord(row) || !hasExactFields(row, RPC_RESULT_FIELDS)) {
    return null;
  }

  const status = row.status;

  if (typeof status !== 'string' || !RPC_STATUSES.has(status as GetPostCommentRpcStatus)) {
    return null;
  }

  if (status !== 'ok') {
    return hasOnlyNullData(row)
      ? { status: status as Exclude<GetPostCommentRpcStatus, 'ok'> }
      : null;
  }

  const parentCommentId = row.parent_comment_id;
  const authorUsername = row.author_username;
  const authorDisplayName = row.author_display_name;
  const directRepliesCount = row.direct_replies_count;

  if (
    !isSameUuid(row.comment_id, request.commentId) ||
    !isSameUuid(row.post_id, request.postId) ||
    (parentCommentId !== null && !isUuid(parentCommentId)) ||
    typeof row.body !== 'string' ||
    row.body.trim() === '' ||
    [...row.body].length > 500 ||
    !isIsoTimestamp(row.created_at) ||
    !isUuid(row.author_id) ||
    (authorUsername !== null && typeof authorUsername !== 'string') ||
    (authorDisplayName !== null && typeof authorDisplayName !== 'string') ||
    typeof directRepliesCount !== 'number' ||
    !Number.isInteger(directRepliesCount) ||
    directRepliesCount < 0
  ) {
    return null;
  }

  return {
    status: 'ok',
    comment: {
      id: row.comment_id,
      postId: row.post_id,
      parentCommentId,
      author: {
        id: row.author_id,
        username: authorUsername,
        displayName: authorDisplayName,
      },
      body: row.body,
      createdAt: row.created_at,
      directRepliesCount,
    },
  };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'GET') {
      return methodNotAllowedResponse();
    }

    // The actor comes only from the verified JWT.
    const authenticatedUserId = context.userClaims?.id;

    if (!isUuid(authenticatedUserId)) {
      return errorResponse(401, 'unauthorized', 'Unauthorized.');
    }

    const validation = validateRequest(request);

    if (!validation.ok) {
      return validation.response;
    }

    const { data, error } = await context.supabaseAdmin.rpc('get_post_comment', {
      p_actor_id: authenticatedUserId,
      p_post_id: validation.postId,
      p_comment_id: validation.commentId,
    });

    if (error) {
      console.error('get_post_comment RPC failed.');
      return readFailedResponse();
    }

    const result = parseRpcResult(data, validation);

    if (!result) {
      console.error('get_post_comment RPC returned an invalid result.');
      return readFailedResponse();
    }

    switch (result.status) {
      case 'ok':
        return Response.json({ comment: result.comment });
      case 'not_found':
        return postNotFoundResponse();
      case 'comment_not_found':
        return commentNotFoundResponse();
      case 'profile_not_ready':
        return profileNotReadyResponse();
      case 'invalid_request':
        return invalidRequestResponse();
      default:
        return readFailedResponse();
    }
  }),
};
