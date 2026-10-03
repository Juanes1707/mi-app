import { withSupabase } from 'npm:@supabase/server@1';

type PostImageExtension = 'jpg' | 'png' | 'webp';

type PostMediaReadValidation =
  | {
      ok: true;
      imagePath: string;
      expectedContentType: string;
    }
  | { ok: false; response: Response };

type AuthorizedPostMedia = {
  postId: string;
  imagePath: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MEDIA_FILENAME_PATTERN =
  /^([0-9a-f-]{36})\.(jpg|png|webp)$/;
const POST_MEDIA_BUCKET = 'post-media';
const SIGNED_URL_TTL_SECONDS = 60;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_QUERY_FIELDS = new Set(['imagePath']);
const CONTENT_TYPE_BY_EXTENSION: Record<PostImageExtension, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

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

function invalidPostMediaReadRequestResponse(): Response {
  return errorResponse(
    400,
    'invalid_post_media_read_request',
    'A valid post image path is required.',
  );
}

function postMediaNotFoundResponse(): Response {
  return errorResponse(404, 'post_media_not_found', 'Post media not found.');
}

function postMediaReadFailedResponse(): Response {
  return errorResponse(
    500,
    'post_media_read_failed',
    'Unable to load post media.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

// Paths are generated server-side as lowercase `${authorId}/${randomUUID()}.ext`,
// so only that canonical form can ever match a published post.
function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID_PATTERN.test(value);
}

function getExpectedContentType(imagePath: string): string | null {
  if (
    imagePath.trim() !== imagePath ||
    imagePath.includes('..') ||
    imagePath.includes('\\')
  ) {
    return null;
  }

  const segments = imagePath.split('/');

  if (segments.length !== 2 || !isCanonicalUuid(segments[0])) {
    return null;
  }

  const filenameMatch = MEDIA_FILENAME_PATTERN.exec(segments[1]);

  if (!filenameMatch || !isCanonicalUuid(filenameMatch[1])) {
    return null;
  }

  const extension = filenameMatch[2] as PostImageExtension;
  return CONTENT_TYPE_BY_EXTENSION[extension];
}

function validatePostMediaReadRequest(request: Request): PostMediaReadValidation {
  const url = new URL(request.url);
  const queryFields = [...url.searchParams.keys()];
  const imagePathValues = url.searchParams.getAll('imagePath');

  if (
    queryFields.some((field) => !ALLOWED_QUERY_FIELDS.has(field)) ||
    imagePathValues.length !== 1 ||
    imagePathValues[0] === ''
  ) {
    return { ok: false, response: invalidPostMediaReadRequestResponse() };
  }

  const imagePath = imagePathValues[0];
  const expectedContentType = getExpectedContentType(imagePath);

  if (!expectedContentType) {
    return { ok: false, response: invalidPostMediaReadRequestResponse() };
  }

  return { ok: true, imagePath, expectedContentType };
}

function parseAuthorizedPostMedia(
  value: unknown,
  requestedImagePath: string,
): AuthorizedPostMedia | 'not_found' | null {
  if (!Array.isArray(value) || value.length > 1) {
    return null;
  }

  if (value.length === 0) {
    return 'not_found';
  }

  const row = value[0];

  if (
    !isRecord(row) ||
    !isUuid(row.post_id) ||
    row.image_path !== requestedImagePath
  ) {
    return null;
  }

  return {
    postId: row.post_id,
    imagePath: row.image_path,
  };
}

function hasReadableMetadata(
  value: unknown,
  expectedContentType: string,
): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.size === 'number' &&
    Number.isInteger(value.size) &&
    value.size > 0 &&
    value.size <= MAX_FILE_SIZE_BYTES &&
    value.contentType === expectedContentType
  );
}

// Storage builds the capability from the authorized imagePath; we only check
// the shape we consume, not Storage's internal URL layout.
function parseSignedUrl(value: unknown): string | null {
  if (
    !isRecord(value) ||
    typeof value.signedUrl !== 'string' ||
    value.signedUrl.trim() === ''
  ) {
    return null;
  }

  let signedUrl: URL;

  try {
    signedUrl = new URL(value.signedUrl);
  } catch {
    return null;
  }

  if (
    (signedUrl.protocol !== 'https:' && signedUrl.protocol !== 'http:') ||
    signedUrl.username !== '' ||
    signedUrl.password !== ''
  ) {
    return null;
  }

  return value.signedUrl;
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

    const validation = validatePostMediaReadRequest(request);

    if (!validation.ok) {
      return validation.response;
    }

    const { data: authorizationData, error: authorizationError } =
      await context.supabaseAdmin.rpc('authorize_post_media_read', {
        p_actor_id: authenticatedUserId,
        p_image_path: validation.imagePath,
      });

    if (authorizationError) {
      console.error('authorize_post_media_read RPC failed.');
      return postMediaReadFailedResponse();
    }

    const authorizedMedia = parseAuthorizedPostMedia(
      authorizationData,
      validation.imagePath,
    );

    if (!authorizedMedia) {
      console.error('authorize_post_media_read RPC returned an invalid result.');
      return postMediaReadFailedResponse();
    }

    if (authorizedMedia === 'not_found') {
      return postMediaNotFoundResponse();
    }

    const { data: mediaInfo, error: mediaInfoError } =
      await context.supabaseAdmin.storage
        .from(POST_MEDIA_BUCKET)
        .info(authorizedMedia.imagePath);

    if (
      mediaInfoError ||
      !hasReadableMetadata(mediaInfo, validation.expectedContentType)
    ) {
      console.error('Authorized post media is unavailable or invalid.');
      return postMediaReadFailedResponse();
    }

    const { data: signedUrlData, error: signedUrlError } =
      await context.supabaseAdmin.storage
        .from(POST_MEDIA_BUCKET)
        .createSignedUrl(authorizedMedia.imagePath, SIGNED_URL_TTL_SECONDS);

    if (signedUrlError) {
      console.error('Unable to create a signed post media URL.');
      return postMediaReadFailedResponse();
    }

    const signedUrl = parseSignedUrl(signedUrlData);

    if (!signedUrl) {
      console.error('Storage returned an invalid signed post media URL.');
      return postMediaReadFailedResponse();
    }

    return Response.json({
      media: {
        imagePath: authorizedMedia.imagePath,
        signedUrl,
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      },
    });
  }),
};
