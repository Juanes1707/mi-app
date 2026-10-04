import { withSupabase } from 'npm:@supabase/server@1';

type PostImageExtension = 'jpg' | 'png' | 'webp';

type PostPublishRequestValidation =
  | {
      ok: true;
      imagePath: string;
      caption: string;
      expectedContentType: string;
    }
  | { ok: false; response: Response };

type PostPublishStatus =
  | 'published'
  | 'already_published'
  | 'profile_not_ready'
  | 'invalid_request';

type PublishedPost = {
  id: string;
  authorId: string;
  imagePath: string;
  caption: string;
  createdAt: string;
};

type PostPublishResult = {
  status: 'published' | 'already_published';
  post: PublishedPost;
};

type FeedPost = {
  id: string;
  author: {
    id: string;
    username: string | null;
    displayName: string | null;
  };
  imagePath: string;
  caption: string;
  createdAt: string;
  likesCount: number;
  commentsCount: number;
  isLiked: boolean;
};

type PostReadResult = FeedPost | 'not_found' | 'profile_not_ready' | 'invalid_request';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_FILENAME_PATTERN =
  /^([0-9a-f-]{36})\.(jpg|png|webp)$/;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const POST_MEDIA_BUCKET = 'post-media';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_CAPTION_LENGTH = 2200;
const REQUIRED_BODY_FIELDS = new Set(['imagePath', 'caption']);
const REQUIRED_READ_QUERY_FIELDS = new Set(['postId']);
const POST_READ_STATUSES = new Set([
  'ok',
  'not_found',
  'profile_not_ready',
  'invalid_request',
]);
const POST_READ_ROW_FIELDS = new Set([
  'status', 'post_id', 'author_id', 'author_username', 'author_display_name',
  'image_path', 'caption', 'created_at', 'likes_count', 'comments_count', 'is_liked',
]);
const CONTENT_TYPE_BY_EXTENSION: Record<PostImageExtension, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const POST_PUBLISH_STATUSES = new Set<PostPublishStatus>([
  'published',
  'already_published',
  'profile_not_ready',
  'invalid_request',
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
      headers: { Allow: 'GET, POST, OPTIONS' },
    },
  );
}

function invalidPostPublishRequestResponse(): Response {
  return errorResponse(
    400,
    'invalid_post_publish_request',
    'A valid post publication request is required.',
  );
}

function invalidPostReadRequestResponse(): Response {
  return errorResponse(400, 'invalid_post_request', 'A valid post request is required.');
}

function postNotFoundResponse(): Response {
  return errorResponse(404, 'post_not_found', 'Post not found.');
}

function postReadFailedResponse(): Response {
  return errorResponse(500, 'post_read_failed', 'Unable to read post.');
}

function postMediaNotReadyResponse(): Response {
  return errorResponse(409, 'post_media_not_ready', 'The post image is not ready.');
}

function profileNotReadyResponse(): Response {
  return errorResponse(409, 'profile_not_ready', 'Your profile is not ready.');
}

function postPublishFailedResponse(): Response {
  return errorResponse(500, 'post_publish_failed', 'Unable to publish post.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth &&
    Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59 &&
    Number(match[7] ?? 0) <= 23 && Number(match[8] ?? 0) <= 59 &&
    Number.isFinite(Date.parse(value));
}

function hasExactFields(value: Record<string, unknown>, fields: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function getRequestedPostId(request: Request): string | null {
  const searchParams = new URL(request.url).searchParams;
  const fields = [...searchParams.keys()];
  const values = searchParams.getAll('postId');

  if (
    fields.length !== 1 ||
    fields.some((field) => !REQUIRED_READ_QUERY_FIELDS.has(field)) ||
    values.length !== 1 ||
    !isUuid(values[0])
  ) {
    return null;
  }

  return values[0].toLowerCase();
}

function parsePostReadResult(value: unknown, requestedPostId: string): PostReadResult | null {
  if (
    !Array.isArray(value) || value.length !== 1 || !isRecord(value[0]) ||
    !hasExactFields(value[0], POST_READ_ROW_FIELDS)
  ) {
    return null;
  }

  const row = value[0];
  const status = row.status;

  if (typeof status !== 'string' || !POST_READ_STATUSES.has(status)) {
    return null;
  }

  if (status !== 'ok') {
    if ([
      row.post_id, row.author_id, row.author_username, row.author_display_name,
      row.image_path, row.caption, row.created_at, row.likes_count,
      row.comments_count, row.is_liked,
    ].some((field) => field !== null)) {
      return null;
    }

    return status as Exclude<PostReadResult, FeedPost>;
  }

  if (
    !isUuid(row.post_id) || row.post_id.toLowerCase() !== requestedPostId ||
    !isUuid(row.author_id) ||
    (row.author_username !== null && typeof row.author_username !== 'string') ||
    (row.author_display_name !== null && typeof row.author_display_name !== 'string') ||
    typeof row.image_path !== 'string' || row.image_path.trim() === '' ||
    typeof row.caption !== 'string' || !isIsoTimestamp(row.created_at) ||
    !Number.isInteger(row.likes_count) || Number(row.likes_count) < 0 ||
    !Number.isInteger(row.comments_count) || Number(row.comments_count) < 0 ||
    typeof row.is_liked !== 'boolean'
  ) {
    return null;
  }

  return {
    id: row.post_id,
    author: {
      id: row.author_id,
      username: row.author_username,
      displayName: row.author_display_name,
    },
    imagePath: row.image_path,
    caption: row.caption,
    createdAt: row.created_at,
    likesCount: row.likes_count as number,
    commentsCount: row.comments_count as number,
    isLiked: row.is_liked,
  };
}

function getExpectedContentType(
  imagePath: string,
  actorId: string,
): string | null {
  if (
    imagePath.trim() !== imagePath ||
    imagePath.includes('\\') ||
    imagePath.includes('..')
  ) {
    return null;
  }

  const segments = imagePath.split('/');

  if (segments.length !== 2 || segments[0] !== actorId) {
    return null;
  }

  const filenameMatch = MEDIA_FILENAME_PATTERN.exec(segments[1]);

  if (!filenameMatch || !isUuid(filenameMatch[1])) {
    return null;
  }

  const extension = filenameMatch[2] as PostImageExtension;
  return CONTENT_TYPE_BY_EXTENSION[extension];
}

async function validatePostPublishRequest(
  request: Request,
  actorId: string,
): Promise<PostPublishRequestValidation> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { ok: false, response: invalidPostPublishRequestResponse() };
  }

  if (!isRecord(body)) {
    return { ok: false, response: invalidPostPublishRequestResponse() };
  }

  const fields = Object.keys(body);

  if (
    fields.length !== REQUIRED_BODY_FIELDS.size ||
    fields.some((field) => !REQUIRED_BODY_FIELDS.has(field)) ||
    typeof body.imagePath !== 'string' ||
    body.imagePath === '' ||
    typeof body.caption !== 'string' ||
    [...body.caption].length > MAX_CAPTION_LENGTH
  ) {
    return { ok: false, response: invalidPostPublishRequestResponse() };
  }

  const expectedContentType = getExpectedContentType(body.imagePath, actorId);

  if (!expectedContentType) {
    return { ok: false, response: invalidPostPublishRequestResponse() };
  }

  return {
    ok: true,
    imagePath: body.imagePath,
    caption: body.caption,
    expectedContentType,
  };
}

function isStorageNotFound(error: unknown): boolean {
  if (!isRecord(error)) {
    return false;
  }

  return error.status === 404 || error.statusCode === '404';
}

function hasPublishableMetadata(
  value: unknown,
  expectedContentType: string,
): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const size = value.size;

  return (
    typeof size === 'number' &&
    Number.isInteger(size) &&
    size > 0 &&
    size <= MAX_FILE_SIZE_BYTES &&
    value.contentType === expectedContentType
  );
}

function parsePostPublishResult(
  value: unknown,
  actorId: string,
  imagePath: string,
): PostPublishResult | 'profile_not_ready' | 'invalid_request' | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }

  const row = value[0];
  const status = row.result_status;

  if (
    typeof status !== 'string' ||
    !POST_PUBLISH_STATUSES.has(status as PostPublishStatus)
  ) {
    return null;
  }

  if (status === 'profile_not_ready' || status === 'invalid_request') {
    if (
      row.post_id !== null ||
      row.author_id !== null ||
      row.image_path !== null ||
      row.caption !== null ||
      row.created_at !== null
    ) {
      return null;
    }

    return status;
  }

  if (
    !isUuid(row.post_id) ||
    !isUuid(row.author_id) ||
    row.author_id.toLowerCase() !== actorId.toLowerCase() ||
    row.image_path !== imagePath ||
    typeof row.caption !== 'string' ||
    !isIsoTimestamp(row.created_at)
  ) {
    return null;
  }

  return {
    status: status as 'published' | 'already_published',
    post: {
      id: row.post_id,
      authorId: row.author_id,
      imagePath: row.image_path,
      caption: row.caption,
      createdAt: row.created_at,
    },
  };
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
      const postId = getRequestedPostId(request);

      if (postId === null) {
        return invalidPostReadRequestResponse();
      }

      const { data, error } = await context.supabaseAdmin.rpc('get_post', {
        p_actor_id: authenticatedUserId,
        p_post_id: postId,
      });

      if (error) {
        console.error('get_post RPC failed.');
        return postReadFailedResponse();
      }

      const result = parsePostReadResult(data, postId);

      if (result === null) {
        console.error('get_post RPC returned an invalid result.');
        return postReadFailedResponse();
      }

      if (result === 'not_found') {
        return postNotFoundResponse();
      }

      if (result === 'profile_not_ready') {
        return profileNotReadyResponse();
      }

      if (result === 'invalid_request') {
        return invalidPostReadRequestResponse();
      }

      return Response.json({ post: result });
    }

    const validation = await validatePostPublishRequest(
      request,
      authenticatedUserId,
    );

    if (!validation.ok) {
      return validation.response;
    }

    const { data: mediaInfo, error: mediaError } = await context.supabaseAdmin.storage
      .from(POST_MEDIA_BUCKET)
      .info(validation.imagePath);

    if (mediaError) {
      if (isStorageNotFound(mediaError)) {
        return postMediaNotReadyResponse();
      }

      console.error('Unable to inspect post media.');
      return postPublishFailedResponse();
    }

    if (!hasPublishableMetadata(mediaInfo, validation.expectedContentType)) {
      return postMediaNotReadyResponse();
    }

    const { data, error } = await context.supabaseAdmin.rpc('publish_post', {
      p_actor_id: authenticatedUserId,
      p_image_path: validation.imagePath,
      p_caption: validation.caption,
    });

    if (error) {
      console.error('publish_post RPC failed.');
      return postPublishFailedResponse();
    }

    const result = parsePostPublishResult(
      data,
      authenticatedUserId,
      validation.imagePath,
    );

    if (!result) {
      console.error('publish_post RPC returned an invalid result.');
      return postPublishFailedResponse();
    }

    if (result === 'profile_not_ready') {
      return profileNotReadyResponse();
    }

    if (result === 'invalid_request') {
      return invalidPostPublishRequestResponse();
    }

    return Response.json(
      { post: result.post },
      { status: result.status === 'published' ? 201 : 200 },
    );
  }),
};
