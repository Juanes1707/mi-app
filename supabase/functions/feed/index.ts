import { withSupabase } from 'npm:@supabase/server@1';

type FeedCursor = {
  createdAt: string;
  postId: string;
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

type FeedRequestValidation =
  | { ok: true; cursor: FeedCursor | null }
  | { ok: false; response: Response };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/;
const FEED_PAGE_SIZE = 20;
const FEED_QUERY_LIMIT = FEED_PAGE_SIZE + 1;
const ALLOWED_QUERY_FIELDS = new Set(['beforeCreatedAt', 'beforePostId']);

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

function invalidFeedRequestResponse(): Response {
  return errorResponse(
    400,
    'invalid_feed_request',
    'A valid feed cursor is required.',
  );
}

function feedReadFailedResponse(): Response {
  return errorResponse(500, 'feed_read_failed', 'Unable to load feed.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = ISO_TIMESTAMP_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === undefined ? 0 : Number(match[7]);
  const offsetMinute = match[8] === undefined ? 0 : Number(match[8]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function validateFeedRequest(request: Request): FeedRequestValidation {
  const url = new URL(request.url);
  const queryFields = [...url.searchParams.keys()];

  if (queryFields.some((field) => !ALLOWED_QUERY_FIELDS.has(field))) {
    return { ok: false, response: invalidFeedRequestResponse() };
  }

  const createdAtValues = url.searchParams.getAll('beforeCreatedAt');
  const postIdValues = url.searchParams.getAll('beforePostId');

  if (createdAtValues.length === 0 && postIdValues.length === 0) {
    return { ok: true, cursor: null };
  }

  if (
    createdAtValues.length !== 1 ||
    postIdValues.length !== 1 ||
    !isIsoTimestamp(createdAtValues[0]) ||
    !isUuid(postIdValues[0])
  ) {
    return { ok: false, response: invalidFeedRequestResponse() };
  }

  return {
    ok: true,
    cursor: {
      createdAt: createdAtValues[0],
      postId: postIdValues[0],
    },
  };
}

function parseFeedPosts(value: unknown): FeedPost[] | null {
  if (!Array.isArray(value) || value.length > FEED_QUERY_LIMIT) {
    return null;
  }

  const posts: FeedPost[] = [];

  for (const row of value) {
    if (!isRecord(row)) {
      return null;
    }

    const authorUsername = row.author_username;
    const authorDisplayName = row.author_display_name;

    if (
      !isUuid(row.post_id) ||
      !isUuid(row.author_id) ||
      (authorUsername !== null && typeof authorUsername !== 'string') ||
      (authorDisplayName !== null && typeof authorDisplayName !== 'string') ||
      typeof row.image_path !== 'string' ||
      row.image_path.trim() === '' ||
      typeof row.caption !== 'string' ||
      !isIsoTimestamp(row.created_at) ||
      !Number.isInteger(row.likes_count) ||
      row.likes_count < 0 ||
      !Number.isInteger(row.comments_count) ||
      row.comments_count < 0 ||
      typeof row.is_liked !== 'boolean'
    ) {
      return null;
    }

    posts.push({
      id: row.post_id,
      author: {
        id: row.author_id,
        username: authorUsername,
        displayName: authorDisplayName,
      },
      imagePath: row.image_path,
      caption: row.caption,
      createdAt: row.created_at,
      likesCount: row.likes_count,
      commentsCount: row.comments_count,
      isLiked: row.is_liked,
    });
  }

  return posts;
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

    const validation = validateFeedRequest(request);

    if (!validation.ok) {
      return validation.response;
    }

    const { data, error } = await context.supabaseAdmin.rpc('list_feed_posts', {
      p_actor_id: authenticatedUserId,
      p_limit: FEED_QUERY_LIMIT,
      p_before_created_at: validation.cursor?.createdAt ?? null,
      p_before_post_id: validation.cursor?.postId ?? null,
    });

    if (error) {
      console.error('list_feed_posts RPC failed.');
      return feedReadFailedResponse();
    }

    const parsedPosts = parseFeedPosts(data);

    if (!parsedPosts) {
      console.error('list_feed_posts RPC returned an invalid result.');
      return feedReadFailedResponse();
    }

    const hasMore = parsedPosts.length === FEED_QUERY_LIMIT;
    const posts = hasMore ? parsedPosts.slice(0, FEED_PAGE_SIZE) : parsedPosts;
    const lastPost = hasMore ? posts[posts.length - 1] : null;
    const nextCursor = lastPost
      ? {
          createdAt: lastPost.createdAt,
          postId: lastPost.id,
        }
      : null;

    return Response.json({ posts, nextCursor });
  }),
};
