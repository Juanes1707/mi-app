import { withSupabase } from 'npm:@supabase/server@1';

type ProfileSearchItem = {
  id: string;
  username: string | null;
  displayName: string | null;
  isPrivate: boolean;
};

type ProfileSearchValidation =
  | { ok: true; query: string }
  | { ok: false; response: Response };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUERY_LENGTH = 50;
const PROFILE_SEARCH_LIMIT = 20;

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

function invalidProfileSearchResponse(): Response {
  return errorResponse(
    400,
    'invalid_profile_search',
    'A valid search query is required.',
  );
}

function profileSearchFailedResponse(): Response {
  return errorResponse(
    500,
    'profile_search_failed',
    'Unable to search profiles.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function validateProfileSearch(request: Request): ProfileSearchValidation {
  const url = new URL(request.url);
  const queryFields = [...url.searchParams.keys()];
  const queries = url.searchParams.getAll('query');

  if (
    queryFields.length !== 1 ||
    queryFields[0] !== 'query' ||
    queries.length !== 1
  ) {
    return { ok: false, response: invalidProfileSearchResponse() };
  }

  const query = queries[0].trim();
  const queryLength = [...query].length;

  if (queryLength === 0 || queryLength > MAX_QUERY_LENGTH) {
    return { ok: false, response: invalidProfileSearchResponse() };
  }

  return { ok: true, query };
}

function parseProfileSearchResult(
  value: unknown,
  actorId: string,
): ProfileSearchItem[] | null {
  if (!Array.isArray(value) || value.length > PROFILE_SEARCH_LIMIT) {
    return null;
  }

  const profiles: ProfileSearchItem[] = [];

  for (const row of value) {
    if (!isRecord(row)) {
      return null;
    }

    const username = row.username;
    const displayName = row.display_name;

    if (
      !isUuid(row.profile_id) ||
      row.profile_id.toLowerCase() === actorId.toLowerCase() ||
      (username !== null && typeof username !== 'string') ||
      (displayName !== null && typeof displayName !== 'string') ||
      typeof row.is_private !== 'boolean'
    ) {
      return null;
    }

    profiles.push({
      id: row.profile_id,
      username,
      displayName,
      isPrivate: row.is_private,
    });
  }

  return profiles;
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

    const validation = validateProfileSearch(request);

    if (!validation.ok) {
      return validation.response;
    }

    const { data, error } = await context.supabaseAdmin.rpc(
      'search_profiles',
      {
        p_actor_id: authenticatedUserId,
        p_query: validation.query,
        p_limit: PROFILE_SEARCH_LIMIT,
      },
    );

    if (error) {
      console.error('search_profiles RPC failed.');
      return profileSearchFailedResponse();
    }

    const profiles = parseProfileSearchResult(data, authenticatedUserId);

    if (!profiles) {
      console.error('search_profiles RPC returned an invalid result.');
      return profileSearchFailedResponse();
    }

    return Response.json({ profiles });
  }),
};
