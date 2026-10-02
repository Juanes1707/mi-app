import { withSupabase } from 'npm:@supabase/server@1';

type ProfileRelationship =
  | { status: 'none' }
  | { status: 'following' }
  | { status: 'request_pending'; requestId: string };

type ProfileView = {
  profile: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    bio: string;
    isPrivate: boolean;
  };
  isSelf: boolean;
  relationship: ProfileRelationship;
};

type ProfileRequestValidation =
  | { ok: true; profileId: string }
  | { ok: false; response: Response };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELATIONSHIP_STATUSES = new Set([
  'none',
  'following',
  'request_pending',
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
      headers: { Allow: 'GET, OPTIONS' },
    },
  );
}

function invalidProfileRequestResponse(): Response {
  return errorResponse(
    400,
    'invalid_profile_request',
    'A valid profileId is required.',
  );
}

function profileNotFoundResponse(): Response {
  return errorResponse(404, 'profile_not_found', 'Profile not found.');
}

function profileReadFailedResponse(): Response {
  return errorResponse(
    500,
    'profile_read_failed',
    'Unable to load profile.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validateProfileRequest(request: Request): ProfileRequestValidation {
  const url = new URL(request.url);
  const queryFields = Array.from(url.searchParams.keys());
  const profileIds = url.searchParams.getAll('profileId');

  if (
    queryFields.length !== 1 ||
    queryFields[0] !== 'profileId' ||
    profileIds.length !== 1 ||
    !isUuid(profileIds[0])
  ) {
    return { ok: false, response: invalidProfileRequestResponse() };
  }

  return { ok: true, profileId: profileIds[0] };
}

function parseProfileView(
  value: unknown,
  actorId: string,
  targetId: string,
): ProfileView | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }

  const row = value[0];
  const username = row.username;
  const displayName = row.display_name;
  const avatarUrl = row.avatar_url;
  const relationshipStatus = row.relationship_status;
  const pendingRequestId = row.pending_request_id;

  if (
    !isUuid(row.profile_id) ||
    row.profile_id.toLowerCase() !== targetId.toLowerCase() ||
    (username !== null && typeof username !== 'string') ||
    (displayName !== null && typeof displayName !== 'string') ||
    (avatarUrl !== null && typeof avatarUrl !== 'string') ||
    typeof row.bio !== 'string' ||
    typeof row.is_private !== 'boolean' ||
    typeof row.is_self !== 'boolean' ||
    typeof relationshipStatus !== 'string' ||
    !RELATIONSHIP_STATUSES.has(relationshipStatus)
  ) {
    return null;
  }

  const expectedIsSelf = actorId.toLowerCase() === targetId.toLowerCase();

  if (row.is_self !== expectedIsSelf) {
    return null;
  }

  let relationship: ProfileRelationship;

  if (relationshipStatus === 'request_pending') {
    if (!isUuid(pendingRequestId) || row.is_self) {
      return null;
    }

    relationship = {
      status: 'request_pending',
      requestId: pendingRequestId,
    };
  } else if (relationshipStatus === 'following') {
    if (pendingRequestId !== null) {
      return null;
    }

    relationship = { status: 'following' };
  } else {
    if (pendingRequestId !== null) {
      return null;
    }

    relationship = { status: 'none' };
  }

  if (row.is_self && relationship.status !== 'none') {
    return null;
  }

  return {
    profile: {
      id: row.profile_id,
      username,
      displayName,
      avatarUrl,
      bio: row.bio,
      isPrivate: row.is_private,
    },
    isSelf: row.is_self,
    relationship,
  };
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'GET') {
      return methodNotAllowedResponse();
    }

    const authenticatedUserId = context.userClaims?.id;

    if (!isUuid(authenticatedUserId)) {
      return errorResponse(401, 'unauthorized', 'Unauthorized.');
    }

    const validation = validateProfileRequest(request);

    if (!validation.ok) {
      return validation.response;
    }

    const { data, error } = await context.supabaseAdmin.rpc(
      'get_profile_view',
      {
        p_actor_id: authenticatedUserId,
        p_target_id: validation.profileId,
      },
    );

    if (error) {
      console.error('get_profile_view RPC failed.');
      return profileReadFailedResponse();
    }

    if (!Array.isArray(data)) {
      console.error('get_profile_view RPC returned an invalid result.');
      return profileReadFailedResponse();
    }

    if (data.length === 0) {
      return profileNotFoundResponse();
    }

    if (data.length > 1) {
      console.error('get_profile_view RPC returned multiple rows.');
      return profileReadFailedResponse();
    }

    const profileView = parseProfileView(
      data,
      authenticatedUserId,
      validation.profileId,
    );

    if (!profileView) {
      console.error('get_profile_view RPC returned an invalid row.');
      return profileReadFailedResponse();
    }

    return Response.json(profileView);
  }),
};
