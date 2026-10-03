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

type CommentCursor = {
  createdAt: string;
  commentId: string;
};

type ListPostCommentsRequestValidation =
  | {
      ok: true;
      postId: string;
      parentCommentId: string | null;
      limit: number;
      cursor: CommentCursor | null;
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

type ListPostCommentsRpcStatus =
  | 'ok'
  | 'not_found'
  | 'parent_not_found'
  | 'profile_not_ready'
  | 'invalid_request';

type CreatedPostComment = {
  id: string;
  postId: string;
  parentCommentId: string | null;
  authorId: string;
  body: string;
  createdAt: string;
};

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

type PostCommentRpcResult =
  | { status: 'created' | 'already_created'; comment: CreatedPostComment }
  | {
      status:
        | 'not_found'
        | 'parent_not_found'
        | 'profile_not_ready'
        | 'invalid_request'
        | 'comment_id_conflict';
    };

type ListPostCommentsRpcResult =
  | { status: 'ok'; comments: PostComment[] }
  | {
      status:
        | 'not_found'
        | 'parent_not_found'
        | 'profile_not_ready'
        | 'invalid_request';
    };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const REQUIRED_BODY_FIELDS = new Set([
  'commentId',
  'postId',
  'parentCommentId',
  'body',
]);
const ALLOWED_GET_QUERY_FIELDS = new Set([
  'postId',
  'parentCommentId',
  'limit',
  'afterCreatedAt',
  'afterCommentId',
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
const LIST_POST_COMMENTS_RPC_STATUSES = new Set<ListPostCommentsRpcStatus>([
  'ok',
  'not_found',
  'parent_not_found',
  'profile_not_ready',
  'invalid_request',
]);
const POST_RPC_RESULT_FIELDS = new Set([
  'status',
  'comment_id',
  'post_id',
  'parent_comment_id',
  'author_id',
  'body',
  'created_at',
]);
const LIST_RPC_RESULT_FIELDS = new Set([
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
const DEFAULT_COMMENTS_LIMIT = 20;
const MAX_COMMENTS_LIMIT = 50;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

function methodNotAllowedResponse(): Response {
  return Response.json(
    { code: 'method_not_allowed', message: 'Method not allowed.' },
    { status: 405, headers: { Allow: 'GET, POST, OPTIONS' } },
  );
}

function invalidPostCommentRequestResponse(): Response {
  return errorResponse(
    400,
    'invalid_post_comment_request',
    'A valid post comment request is required.',
  );
}

function invalidPostCommentsRequestResponse(): Response {
  return errorResponse(
    400,
    'invalid_post_comments_request',
    'A valid post comments request is required.',
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

function postCommentsReadFailedResponse(): Response {
  return errorResponse(
    500,
    'post_comments_read_failed',
    'Unable to load post comments.',
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

function parseIsoTimestampOrderKey(value: unknown): bigint | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = ISO_TIMESTAMP_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const epochMilliseconds = Date.parse(value);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    !Number.isFinite(epochMilliseconds)
  ) {
    return null;
  }

  const fraction = (match[7] ?? '').padEnd(6, '0');
  const subMillisecondMicroseconds = Number(fraction.slice(3, 6));

  return BigInt(epochMilliseconds) * 1000n + BigInt(subMillisecondMicroseconds);
}

function isIsoTimestamp(value: unknown): value is string {
  return parseIsoTimestampOrderKey(value) !== null;
}

function compareCommentPositions(
  leftCreatedAt: string,
  leftCommentId: string,
  rightCreatedAt: string,
  rightCommentId: string,
): number {
  const leftTimestamp = parseIsoTimestampOrderKey(leftCreatedAt);
  const rightTimestamp = parseIsoTimestampOrderKey(rightCreatedAt);

  if (leftTimestamp === null || rightTimestamp === null) {
    return 0;
  }

  if (leftTimestamp < rightTimestamp) {
    return -1;
  }

  if (leftTimestamp > rightTimestamp) {
    return 1;
  }

  const leftId = leftCommentId.toLowerCase();
  const rightId = rightCommentId.toLowerCase();

  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function hasExactFields(row: Record<string, unknown>, expected: Set<string>): boolean {
  const fields = Object.keys(row);
  return fields.length === expected.size && fields.every((field) => expected.has(field));
}

function hasOnlyNullPostData(row: Record<string, unknown>): boolean {
  return (
    row.comment_id === null &&
    row.post_id === null &&
    row.parent_comment_id === null &&
    row.author_id === null &&
    row.body === null &&
    row.created_at === null
  );
}

function hasOnlyNullListData(row: Record<string, unknown>): boolean {
  return (
    row.comment_id === null &&
    row.post_id === null &&
    row.parent_comment_id === null &&
    row.body === null &&
    row.created_at === null &&
    row.author_id === null &&
    row.author_username === null &&
    row.author_display_name === null &&
    row.direct_replies_count === null
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

function validateListPostCommentsRequest(
  request: Request,
): ListPostCommentsRequestValidation {
  const url = new URL(request.url);
  const queryFields = [...url.searchParams.keys()];

  if (
    queryFields.some((field) => !ALLOWED_GET_QUERY_FIELDS.has(field)) ||
    [...ALLOWED_GET_QUERY_FIELDS].some(
      (field) => url.searchParams.getAll(field).length > 1,
    )
  ) {
    return { ok: false, response: invalidPostCommentsRequestResponse() };
  }

  const postIdValues = url.searchParams.getAll('postId');
  const parentCommentIdValues = url.searchParams.getAll('parentCommentId');
  const limitValues = url.searchParams.getAll('limit');
  const afterCreatedAtValues = url.searchParams.getAll('afterCreatedAt');
  const afterCommentIdValues = url.searchParams.getAll('afterCommentId');

  if (
    postIdValues.length !== 1 ||
    !isUuid(postIdValues[0]) ||
    (parentCommentIdValues.length === 1 && !isUuid(parentCommentIdValues[0]))
  ) {
    return { ok: false, response: invalidPostCommentsRequestResponse() };
  }

  let limit = DEFAULT_COMMENTS_LIMIT;

  if (limitValues.length === 1) {
    const limitValue = limitValues[0];

    if (limitValue === undefined || !/^[1-9]\d*$/.test(limitValue)) {
      return { ok: false, response: invalidPostCommentsRequestResponse() };
    }

    limit = Number(limitValue);

    if (!Number.isSafeInteger(limit) || limit > MAX_COMMENTS_LIMIT) {
      return { ok: false, response: invalidPostCommentsRequestResponse() };
    }
  }

  if (afterCreatedAtValues.length === 0 && afterCommentIdValues.length === 0) {
    return {
      ok: true,
      postId: postIdValues[0],
      parentCommentId: parentCommentIdValues[0] ?? null,
      limit,
      cursor: null,
    };
  }

  if (
    afterCreatedAtValues.length !== 1 ||
    afterCommentIdValues.length !== 1 ||
    !isIsoTimestamp(afterCreatedAtValues[0]) ||
    !isUuid(afterCommentIdValues[0])
  ) {
    return { ok: false, response: invalidPostCommentsRequestResponse() };
  }

  return {
    ok: true,
    postId: postIdValues[0],
    parentCommentId: parentCommentIdValues[0] ?? null,
    limit,
    cursor: {
      createdAt: afterCreatedAtValues[0],
      commentId: afterCommentIdValues[0],
    },
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

  if (
    !hasExactFields(row, POST_RPC_RESULT_FIELDS) ||
    typeof status !== 'string' ||
    !POST_COMMENT_RPC_STATUSES.has(status as PostCommentRpcStatus)
  ) {
    return null;
  }

  if (status !== 'created' && status !== 'already_created') {
    return hasOnlyNullPostData(row)
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
    !isIsoTimestamp(row.created_at)
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

function parseListPostCommentsRpcResult(
  value: unknown,
  request: Extract<ListPostCommentsRequestValidation, { ok: true }>,
): ListPostCommentsRpcResult | null {
  const queryLimit = request.limit + 1;

  if (!Array.isArray(value) || value.length === 0 || value.length > queryLimit) {
    return null;
  }

  for (const row of value) {
    if (!isRecord(row) || !hasExactFields(row, LIST_RPC_RESULT_FIELDS)) {
      return null;
    }
  }

  const firstRow = value[0] as Record<string, unknown>;
  const firstStatus = firstRow.status;

  if (
    typeof firstStatus !== 'string' ||
    !LIST_POST_COMMENTS_RPC_STATUSES.has(firstStatus as ListPostCommentsRpcStatus)
  ) {
    return null;
  }

  if (firstStatus !== 'ok') {
    return value.length === 1 && hasOnlyNullListData(firstRow)
      ? {
          status: firstStatus as Exclude<ListPostCommentsRpcStatus, 'ok'>,
        }
      : null;
  }

  if (
    value.some(
      (row) => (row as Record<string, unknown>).status !== 'ok',
    )
  ) {
    return null;
  }

  if (value.length === 1 && hasOnlyNullListData(firstRow)) {
    return { status: 'ok', comments: [] };
  }

  const comments: PostComment[] = [];
  let previousCreatedAt = request.cursor?.createdAt ?? null;
  let previousCommentId = request.cursor?.commentId ?? null;

  for (const untypedRow of value) {
    const row = untypedRow as Record<string, unknown>;
    const authorUsername = row.author_username;
    const authorDisplayName = row.author_display_name;
    const directRepliesCount = row.direct_replies_count;

    if (
      !isUuid(row.comment_id) ||
      !isSameUuid(row.post_id, request.postId) ||
      (request.parentCommentId === null
        ? row.parent_comment_id !== null
        : !isSameUuid(row.parent_comment_id, request.parentCommentId)) ||
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

    if (
      previousCreatedAt !== null &&
      previousCommentId !== null &&
      compareCommentPositions(
        row.created_at,
        row.comment_id,
        previousCreatedAt,
        previousCommentId,
      ) <= 0
    ) {
      return null;
    }

    comments.push({
      id: row.comment_id,
      postId: row.post_id,
      parentCommentId: row.parent_comment_id as string | null,
      author: {
        id: row.author_id,
        username: authorUsername,
        displayName: authorDisplayName,
      },
      body: row.body,
      createdAt: row.created_at,
      directRepliesCount,
    });
    previousCreatedAt = row.created_at;
    previousCommentId = row.comment_id;
  }

  return { status: 'ok', comments };
}

async function handleCreatePostComment(
  request: Request,
  context: Parameters<Parameters<typeof withSupabase>[1]>[1],
  authenticatedUserId: string,
): Promise<Response> {
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
}

async function handleListPostComments(
  request: Request,
  context: Parameters<Parameters<typeof withSupabase>[1]>[1],
  authenticatedUserId: string,
): Promise<Response> {
  const validation = validateListPostCommentsRequest(request);

  if (!validation.ok) {
    return validation.response;
  }

  const { data, error } = await context.supabaseAdmin.rpc('list_post_comments', {
    p_actor_id: authenticatedUserId,
    p_post_id: validation.postId,
    p_parent_comment_id: validation.parentCommentId,
    p_limit: validation.limit + 1,
    p_after_created_at: validation.cursor?.createdAt ?? null,
    p_after_comment_id: validation.cursor?.commentId ?? null,
  });

  if (error) {
    console.error('list_post_comments RPC failed.');
    return postCommentsReadFailedResponse();
  }

  const result = parseListPostCommentsRpcResult(data, validation);

  if (!result) {
    console.error('list_post_comments RPC returned an invalid result.');
    return postCommentsReadFailedResponse();
  }

  switch (result.status) {
    case 'ok': {
      const hasMore = result.comments.length > validation.limit;
      const comments = hasMore
        ? result.comments.slice(0, validation.limit)
        : result.comments;
      const lastComment = hasMore ? comments[comments.length - 1] : null;
      const nextCursor = lastComment
        ? {
            createdAt: lastComment.createdAt,
            commentId: lastComment.id,
          }
        : null;

      return Response.json({ comments, nextCursor });
    }
    case 'not_found':
      return postNotFoundResponse();
    case 'parent_not_found':
      return parentCommentNotFoundResponse();
    case 'profile_not_ready':
      return profileNotReadyResponse();
    case 'invalid_request':
      return invalidPostCommentsRequestResponse();
    default:
      return postCommentsReadFailedResponse();
  }
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'GET' && request.method !== 'POST') {
      return methodNotAllowedResponse();
    }

    const authenticatedUserId = context.userClaims?.id;

    if (!isUuid(authenticatedUserId)) {
      return errorResponse(401, 'unauthorized', 'Unauthorized.');
    }

    if (request.method === 'GET') {
      return handleListPostComments(request, context, authenticatedUserId);
    }

    return handleCreatePostComment(request, context, authenticatedUserId);
  }),
};
