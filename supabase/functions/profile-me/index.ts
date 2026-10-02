import { withSupabase } from 'npm:@supabase/server@1';

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  bio: string;
  is_private: boolean;
  created_at: string;
  updated_at: string;
};

type ProfileUpdate = {
  username?: string;
  display_name?: string | null;
  bio?: string;
  is_private?: boolean;
};

type ProfileUpdateValidation =
  | { ok: true; update: ProfileUpdate }
  | { ok: false; response: Response };

const PROFILE_COLUMNS =
  'id, username, display_name, avatar_url, bio, is_private, created_at, updated_at';
const ALLOWED_UPDATE_FIELDS = new Set([
  'username',
  'displayName',
  'bio',
  'isPrivate',
]);
const USERNAME_PATTERN = /^[a-z0-9._]{3,30}$/;
const MAX_DISPLAY_NAME_LENGTH = 50;
const MAX_BIO_LENGTH = 150;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status });
}

function toProfileDto(profile: ProfileRow) {
  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    avatarUrl: profile.avatar_url,
    bio: profile.bio,
    isPrivate: profile.is_private,
    createdAt: profile.created_at,
    updatedAt: profile.updated_at,
  };
}

function profileResponse(profile: ProfileRow): Response {
  return Response.json({ profile: toProfileDto(profile) });
}

function hasOwnField(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

async function validateProfileUpdate(
  request: Request,
): Promise<ProfileUpdateValidation> {
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

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'invalid_profile_update',
        'Request body must be a JSON object.',
      ),
    };
  }

  const updateBody = body as Record<string, unknown>;
  const fields = Object.keys(updateBody);

  if (fields.length === 0) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'empty_profile_update',
        'At least one profile field is required.',
      ),
    };
  }

  if (fields.some((field) => !ALLOWED_UPDATE_FIELDS.has(field))) {
    return {
      ok: false,
      response: errorResponse(
        400,
        'invalid_profile_update',
        'The profile update contains unsupported fields.',
      ),
    };
  }

  const update: ProfileUpdate = {};

  if (hasOwnField(updateBody, 'username')) {
    if (typeof updateBody.username !== 'string') {
      return {
        ok: false,
        response: errorResponse(
          400,
          'invalid_username',
          'Username must be a string with a valid format.',
        ),
      };
    }

    const username = updateBody.username.trim().toLowerCase();

    if (!USERNAME_PATTERN.test(username)) {
      return {
        ok: false,
        response: errorResponse(
          400,
          'invalid_username',
          'Username must contain 3 to 30 lowercase letters, numbers, dots, or underscores.',
        ),
      };
    }

    update.username = username;
  }

  if (hasOwnField(updateBody, 'displayName')) {
    if (
      updateBody.displayName !== null &&
      typeof updateBody.displayName !== 'string'
    ) {
      return {
        ok: false,
        response: errorResponse(
          400,
          'invalid_display_name',
          'Display name must be a string or null.',
        ),
      };
    }

    const displayName =
      typeof updateBody.displayName === 'string'
        ? updateBody.displayName.trim()
        : null;

    if (displayName !== null && displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      return {
        ok: false,
        response: errorResponse(
          400,
          'invalid_display_name',
          'Display name must contain at most 50 characters.',
        ),
      };
    }

    update.display_name = displayName === '' ? null : displayName;
  }

  if (hasOwnField(updateBody, 'bio')) {
    if (typeof updateBody.bio !== 'string') {
      return {
        ok: false,
        response: errorResponse(
          400,
          'invalid_bio',
          'Bio must be a string.',
        ),
      };
    }

    const bio = updateBody.bio.trim();

    if (bio.length > MAX_BIO_LENGTH) {
      return {
        ok: false,
        response: errorResponse(
          400,
          'invalid_bio',
          'Bio must contain at most 150 characters.',
        ),
      };
    }

    update.bio = bio;
  }

  if (hasOwnField(updateBody, 'isPrivate')) {
    if (typeof updateBody.isPrivate !== 'boolean') {
      return {
        ok: false,
        response: errorResponse(
          400,
          'invalid_privacy',
          'Privacy setting must be a boolean.',
        ),
      };
    }

    update.is_private = updateBody.isPrivate;
  }

  return { ok: true, update };
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

function profileNotFoundResponse(): Response {
  return Response.json(
    {
      code: 'profile_not_found',
      message: 'Profile not found.',
    },
    { status: 404 },
  );
}

function profileReadFailedResponse(): Response {
  return Response.json(
    {
      code: 'profile_read_failed',
      message: 'Unable to load profile.',
    },
    { status: 500 },
  );
}

function profileUpdateFailedResponse(): Response {
  return errorResponse(
    500,
    'profile_update_failed',
    'Unable to update profile.',
  );
}

function usernameTakenResponse(): Response {
  return errorResponse(
    409,
    'username_taken',
    'Username is already in use.',
  );
}

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, context) => {
    if (request.method !== 'GET' && request.method !== 'PATCH') {
      return methodNotAllowedResponse();
    }

    const authenticatedUserId = context.userClaims?.id;

    if (!authenticatedUserId) {
      return Response.json(
        {
          code: 'unauthorized',
          message: 'Unauthorized.',
        },
        { status: 401 },
      );
    }

    if (request.method === 'GET') {
      const { data, error } = await context.supabaseAdmin
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', authenticatedUserId)
        .maybeSingle();

      if (error) {
        return profileReadFailedResponse();
      }

      const profile = data as ProfileRow | null;

      if (!profile) {
        return profileNotFoundResponse();
      }

      return profileResponse(profile);
    }

    const validation = await validateProfileUpdate(request);

    if (!validation.ok) {
      return validation.response;
    }

    const { data, error } = await context.supabaseAdmin
      .from('profiles')
      .update(validation.update)
      .eq('id', authenticatedUserId)
      .select(PROFILE_COLUMNS)
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        return usernameTakenResponse();
      }

      return profileUpdateFailedResponse();
    }

    const profile = data as ProfileRow | null;

    if (!profile) {
      return profileNotFoundResponse();
    }

    return profileResponse(profile);
  }),
};
