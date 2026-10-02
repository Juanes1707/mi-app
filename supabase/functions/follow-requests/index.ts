import { withSupabase } from 'npm:@supabase/server@1';

type FollowRequestDecision = 'accept' | 'reject';

type FollowRequestRpcStatus =
  | 'accepted'
  | 'rejected'
  | 'request_not_found'
  | 'already_resolved'
  | 'invalid_decision';

type FollowRequestValidation =
  | {
      ok: true;
      requestId: string;
      decision: FollowRequestDecision;
    }
  | { ok: false; response: Response };

type PendingFollowRequest = {
  id: string;
  requester: {
    id: string;
    username: string | null;
    displayName: string | null;
  };
  createdAt: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_BODY_FIELDS = new Set(['requestId', 'decision']);
const RPC_STATUSES = new Set<FollowRequestRpcStatus>([
  'accepted',
  'rejected',
  'request_not_found',
  'already_resolved',
  'invalid_decision',
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
      headers: { Allow: 'GET, PATCH, OPTIONS' },
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isDecision(value: unknown): value is FollowRequestDecision {
  return value === 'accept' || value === 'reject';
}

async function validateFollowRequestResponse(
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
        'invalid_follow_request_response',
        'Request body must be a JSON object.',
      ),
    };
  }

  const fields = Object.keys(body);

  if (
    fields.length !== ALLOWED_BODY_FIELDS.size ||
    fields.some((field) => !ALLOWED_BODY_FIELDS.has(field)) ||
    !isUuid(body.requestId) ||
    !isDecision(body.decision)
  ) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'invalid_follow_request_response',
        'Request body must contain only a valid requestId UUID and decision.',
      ),
    };
  }

  return {
    ok: true,
    requestId: body.requestId,
    decision: body.decision,
  };
}

function parseRpcStatus(value: unknown): FollowRequestRpcStatus | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }

  const resultStatus = value[0].result_status;

  if (
    typeof resultStatus !== 'string' ||
    !RPC_STATUSES.has(resultStatus as FollowRequestRpcStatus)
  ) {
    return null;
  }

  return resultStatus as FollowRequestRpcStatus;
}

function parsePendingFollowRequests(
  value: unknown,
): PendingFollowRequest[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const requests: PendingFollowRequest[] = [];

  for (const row of value) {
    if (!isRecord(row)) {
      return null;
    }

    const requesterUsername = row.requester_username;
    const requesterDisplayName = row.requester_display_name;

    if (
      typeof row.request_id !== 'string' ||
      typeof row.requester_id !== 'string' ||
      (requesterUsername !== null && typeof requesterUsername !== 'string') ||
      (requesterDisplayName !== null &&
        typeof requesterDisplayName !== 'string') ||
      typeof row.created_at !== 'string'
    ) {
      return null;
    }

    requests.push({
      id: row.request_id,
      requester: {
        id: row.requester_id,
        username: requesterUsername,
        displayName: requesterDisplayName,
      },
      createdAt: row.created_at,
    });
  }

  return requests;
}

function responseFailedResponse(): Response {
  return errorResponse(
    500,
    'follow_request_response_failed',
    'Unable to respond to follow request.',
  );
}

function readFailedResponse(): Response {
  return errorResponse(
    500,
    'follow_requests_read_failed',
    'Unable to load follow requests.',
  );
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'GET' && request.method !== 'PATCH') {
      return methodNotAllowedResponse();
    }

    const authenticatedUserId = context.userClaims?.id;

    if (!authenticatedUserId) {
      return errorResponse(401, 'unauthorized', 'Unauthorized.');
    }

    if (request.method === 'GET') {
      const { data, error } = await context.supabaseAdmin.rpc(
        'list_pending_follow_requests',
        {
          p_actor_id: authenticatedUserId,
        },
      );

      if (error) {
        console.error('list_pending_follow_requests RPC failed.');
        return readFailedResponse();
      }

      const requests = parsePendingFollowRequests(data);

      if (!requests) {
        console.error(
          'list_pending_follow_requests RPC returned an invalid result.',
        );
        return readFailedResponse();
      }

      return Response.json({ requests });
    }

    const validation = await validateFollowRequestResponse(request);

    if (!validation.ok) {
      return validation.response;
    }

    const { data, error } = await context.supabaseAdmin.rpc(
      'respond_follow_request',
      {
        p_actor_id: authenticatedUserId,
        p_request_id: validation.requestId,
        p_decision: validation.decision,
      },
    );

    if (error) {
      console.error('respond_follow_request RPC failed.');
      return responseFailedResponse();
    }

    const resultStatus = parseRpcStatus(data);

    if (!resultStatus) {
      console.error('respond_follow_request RPC returned an invalid result.');
      return responseFailedResponse();
    }

    switch (resultStatus) {
      case 'accepted':
        return Response.json({ status: 'accepted' });
      case 'rejected':
        return Response.json({ status: 'rejected' });
      case 'request_not_found':
        return errorResponse(
          404,
          'follow_request_not_found',
          'Follow request not found.',
        );
      case 'already_resolved':
        return errorResponse(
          409,
          'follow_request_already_resolved',
          'Follow request has already been resolved.',
        );
      case 'invalid_decision':
        return errorResponse(
          400,
          'invalid_follow_request_decision',
          'Follow request decision must be accept or reject.',
        );
      default:
        return responseFailedResponse();
    }
  }),
};
