import { withSupabase } from 'npm:@supabase/server@1';

type FollowRpcStatus =
  | 'following'
  | 'request_pending'
  | 'target_not_found'
  | 'requester_profile_not_found'
  | 'self_follow';

type FollowRpcResult = {
  status: FollowRpcStatus;
  requestId: string | null;
};

type FollowRequestValidation =
  | { ok: true; targetProfileId: string }
  | { ok: false; response: Response };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOLLOW_RPC_STATUSES = new Set<FollowRpcStatus>([
  'following',
  'request_pending',
  'target_not_found',
  'requester_profile_not_found',
  'self_follow',
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
      headers: { Allow: 'POST, OPTIONS' },
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

async function validateFollowRequest(
  request: Request,
): Promise<FollowRequestValidation> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: errorResponse(
        400,
        'invalid_json',
        'Request body must contain valid JSON.',
      ),
    };
  }

  if (!isRecord(body)) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'invalid_follow_request',
        'Request body must be a JSON object.',
      ),
    };
  }

  const fields = Object.keys(body);

  if (
    fields.length !== 1 ||
    fields[0] !== 'targetProfileId' ||
    !isUuid(body.targetProfileId)
  ) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'invalid_follow_request',
        'Request body must contain only a valid targetProfileId UUID.',
      ),
    };
  }

  return { ok: true, targetProfileId: body.targetProfileId };
}

function parseFollowRpcResult(value: unknown): FollowRpcResult | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }

  const row = value[0];
  const resultStatus = row.result_status;
  const requestId = row.request_id;

  if (
    typeof resultStatus !== 'string' ||
    !FOLLOW_RPC_STATUSES.has(resultStatus as FollowRpcStatus)
  ) {
    return null;
  }

  if (resultStatus === 'request_pending') {
    if (!isUuid(requestId)) {
      return null;
    }

    return { status: resultStatus, requestId };
  }

  if (requestId !== null) {
    return null;
  }

  return { status: resultStatus as FollowRpcStatus, requestId: null };
}

function followFailedResponse(): Response {
  return errorResponse(
    500,
    'follow_failed',
    'Unable to update follow relationship.',
  );
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'POST') {
      return methodNotAllowedResponse();
    }

    const authenticatedUserId = context.userClaims?.id;

    if (!authenticatedUserId) {
      return errorResponse(401, 'unauthorized', 'Unauthorized.');
    }

    const validation = await validateFollowRequest(request);

    if (!validation.ok) {
      return validation.response;
    }

    if (authenticatedUserId === validation.targetProfileId) {
      return errorResponse(
        400,
        'cannot_follow_self',
        'You cannot follow your own profile.',
      );
    }

    const { data, error } = await context.supabaseAdmin.rpc('request_follow', {
      p_requester_id: authenticatedUserId,
      p_target_id: validation.targetProfileId,
    });

    if (error) {
      console.error('request_follow RPC failed.');
      return followFailedResponse();
    }

    const result = parseFollowRpcResult(data);

    if (!result) {
      console.error('request_follow RPC returned an invalid result.');
      return followFailedResponse();
    }

    switch (result.status) {
      case 'following':
        return Response.json({ status: 'following' });
      case 'request_pending':
        return Response.json({
          status: 'request_pending',
          requestId: result.requestId,
        });
      case 'self_follow':
        return errorResponse(
          400,
          'cannot_follow_self',
          'You cannot follow your own profile.',
        );
      case 'target_not_found':
        return errorResponse(404, 'profile_not_found', 'Profile not found.');
      case 'requester_profile_not_found':
        return errorResponse(
          409,
          'profile_not_ready',
          'Your profile is not ready.',
        );
      default:
        return followFailedResponse();
    }
  }),
};
