import { withSupabase } from 'npm:@supabase/server@1';

type PostLikeRequestValidation =
  | { ok: true; postId: string; liked: boolean }
  | { ok: false; response: Response };

type PostLikeRpcStatus = 'updated' | 'not_found' | 'profile_not_ready';

type PostLikeState = {
  postId: string;
  liked: boolean;
  likesCount: number;
};

type PostLikeRpcResult =
  | { status: 'updated'; like: PostLikeState }
  | { status: 'not_found' | 'profile_not_ready' };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUIRED_BODY_FIELDS = new Set(['postId', 'liked']);
const POST_LIKE_RPC_STATUSES = new Set<PostLikeRpcStatus>([
  'updated',
  'not_found',
  'profile_not_ready',
]);

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

function methodNotAllowedResponse(): Response {
  return Response.json(
    {
      code: 'method_not_allowed',
      message: 'Method not allowed.',
    },
    {
      status: 405,
      headers: { Allow: 'PUT, OPTIONS' },
    },
  );
}

function invalidPostLikeRequestResponse(): Response {
  return errorResponse(
    400,
    'invalid_post_like_request',
    'A valid post like request is required.',
  );
}

// Same response for "does not exist" and "exists but you may not see it".
function postNotFoundResponse(): Response {
  return errorResponse(404, 'post_not_found', 'Post not found.');
}

function profileNotReadyResponse(): Response {
  return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
}

function postLikeUpdateFailedResponse(): Response {
  return errorResponse(500, 'post_like_update_failed', 'Unable to update post like.');
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

// The body states the DESIRED state ({ postId, liked }), never a toggle, and carries
// no identity: the actor always comes from the verified JWT.
async function validatePostLikeRequest(request: Request): Promise<PostLikeRequestValidation> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { ok: false, response: invalidPostLikeRequestResponse() };
  }

  if (!isRecord(body)) {
    return { ok: false, response: invalidPostLikeRequestResponse() };
  }

  const fields = Object.keys(body);

  if (
    fields.length !== REQUIRED_BODY_FIELDS.size ||
    fields.some((field) => !REQUIRED_BODY_FIELDS.has(field)) ||
    !isUuid(body.postId) ||
    typeof body.liked !== 'boolean'
  ) {
    return { ok: false, response: invalidPostLikeRequestResponse() };
  }

  return { ok: true, postId: body.postId, liked: body.liked };
}

function parsePostLikeRpcResult(value: unknown, postId: string): PostLikeRpcResult | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }

  const row = value[0];
  const status = row.status;

  if (
    typeof status !== 'string' ||
    !POST_LIKE_RPC_STATUSES.has(status as PostLikeRpcStatus) ||
    !isSameUuid(row.post_id, postId)
  ) {
    return null;
  }

  if (status === 'not_found' || status === 'profile_not_ready') {
    // A hidden post must never leak its like state or count.
    if (row.liked !== null || row.likes_count !== null) {
      return null;
    }

    return { status };
  }

  const likesCount = row.likes_count;

  if (
    typeof row.liked !== 'boolean' ||
    typeof likesCount !== 'number' ||
    !Number.isSafeInteger(likesCount) ||
    likesCount < 0
  ) {
    return null;
  }

  return {
    status: 'updated',
    like: { postId: row.post_id, liked: row.liked, likesCount },
  };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'PUT') {
      return methodNotAllowedResponse();
    }

    const authenticatedUserId = context.userClaims?.id;

    if (!isUuid(authenticatedUserId)) {
      return errorResponse(401, 'unauthorized', 'Unauthorized.');
    }

    const validation = await validatePostLikeRequest(request);

    if (!validation.ok) {
      return validation.response;
    }

    // The whole transition (profile check, visibility, insert/delete, count) is one
    // PostgreSQL function call: no table is read or written from here.
    const { data, error } = await context.supabaseAdmin.rpc('set_post_like', {
      p_actor_id: authenticatedUserId,
      p_post_id: validation.postId,
      p_liked: validation.liked,
    });

    if (error) {
      console.error('set_post_like RPC failed.');
      return postLikeUpdateFailedResponse();
    }

    const result = parsePostLikeRpcResult(data, validation.postId);

    if (!result) {
      console.error('set_post_like RPC returned an invalid result.');
      return postLikeUpdateFailedResponse();
    }

    switch (result.status) {
      case 'updated':
        return Response.json({ like: result.like });
      case 'not_found':
        return postNotFoundResponse();
      case 'profile_not_ready':
        return profileNotReadyResponse();
      default:
        return postLikeUpdateFailedResponse();
    }
  }),
};
