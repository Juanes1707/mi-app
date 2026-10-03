import { withSupabase } from 'npm:@supabase/server@1';

type AllowedContentType = 'image/jpeg' | 'image/png' | 'image/webp';

type PostMediaRequestValidation =
  | {
      ok: true;
      contentType: AllowedContentType;
      fileSize: number;
    }
  | { ok: false; response: Response };

type SignedUploadData = {
  signedUrl: string;
  path: string;
  token: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POST_MEDIA_BUCKET = 'post-media';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const REQUIRED_BODY_FIELDS = new Set(['contentType', 'fileSize']);
const FILE_EXTENSION_BY_CONTENT_TYPE: Record<AllowedContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
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
      headers: { Allow: 'POST, OPTIONS' },
    },
  );
}

function invalidPostMediaRequestResponse(): Response {
  return errorResponse(
    400,
    'invalid_post_media_request',
    'A valid image upload request is required.',
  );
}

function postMediaUploadUnavailableResponse(): Response {
  return errorResponse(
    500,
    'post_media_upload_unavailable',
    'Unable to prepare image upload.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isAllowedContentType(value: unknown): value is AllowedContentType {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(FILE_EXTENSION_BY_CONTENT_TYPE, value)
  );
}

async function validatePostMediaRequest(
  request: Request,
): Promise<PostMediaRequestValidation> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { ok: false, response: invalidPostMediaRequestResponse() };
  }

  if (!isRecord(body)) {
    return { ok: false, response: invalidPostMediaRequestResponse() };
  }

  const fields = Object.keys(body);

  if (
    fields.length !== REQUIRED_BODY_FIELDS.size ||
    fields.some((field) => !REQUIRED_BODY_FIELDS.has(field)) ||
    !isAllowedContentType(body.contentType) ||
    !Number.isInteger(body.fileSize) ||
    body.fileSize <= 0 ||
    body.fileSize > MAX_FILE_SIZE_BYTES
  ) {
    return { ok: false, response: invalidPostMediaRequestResponse() };
  }

  return {
    ok: true,
    contentType: body.contentType,
    fileSize: body.fileSize,
  };
}

function parseSignedUploadData(
  value: unknown,
  expectedPath: string,
): SignedUploadData | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.signedUrl !== 'string' ||
    value.signedUrl.trim() === '' ||
    value.path !== expectedPath ||
    typeof value.token !== 'string' ||
    value.token.trim() === ''
  ) {
    return null;
  }

  return {
    signedUrl: value.signedUrl,
    path: value.path,
    token: value.token,
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

    const validation = await validatePostMediaRequest(request);

    if (!validation.ok) {
      return validation.response;
    }

    const extension = FILE_EXTENSION_BY_CONTENT_TYPE[validation.contentType];
    const path = `${authenticatedUserId}/${crypto.randomUUID()}.${extension}`;
    const { data, error } = await context.supabaseAdmin.storage
      .from(POST_MEDIA_BUCKET)
      .createSignedUploadUrl(path, { upsert: false });

    if (error) {
      console.error('Unable to create signed post media upload capability.');
      return postMediaUploadUnavailableResponse();
    }

    const signedUpload = parseSignedUploadData(data, path);

    if (!signedUpload) {
      console.error('Storage returned an invalid signed upload capability.');
      return postMediaUploadUnavailableResponse();
    }

    return Response.json({
      upload: {
        bucket: POST_MEDIA_BUCKET,
        path: signedUpload.path,
        token: signedUpload.token,
      },
    });
  }),
};
