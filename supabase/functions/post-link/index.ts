// Public HTTPS bridge for shared Post links. Messaging apps only make http(s) links
// tappable, so the shared link points here and this function answers with a
// redirect to the app link the device then intercepts:
//   - installed app:  instagramclone://post/{uuid}
//   - Expo Go (dev):  exp://<dev server>/--/post/{uuid}, only when enabled on the server
// No data is read: opening the Post still goes through the authorized Edge read.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_PATTERN = /\/post-link\/([^/]+)\/?$/;
const HOST_PATTERN = /^[a-z0-9.-]+$/i;
const MAX_TARGET_LENGTH = 512;
export const APP_SCHEME = 'instagramclone';

export type PostLinkOptions = {
  // Development only: allows the redirect to an Expo Go dev server (POST_LINK_EXPO_GO_REDIRECTS=enabled).
  expoGoRedirects: boolean;
};

const BASE_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Type': 'text/plain; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function text(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...BASE_HEADERS, ...headers } });
}

// The Expo Go target is accepted only when it is exactly this Post's route on an
// exp(s):// dev server: no other path, no credentials, query or fragment. Anything
// else falls back to the installed app link, so the function is never an open redirect.
function expoGoTarget(rawTarget: string | null, postId: string): string | null {
  if (rawTarget === null || rawTarget.length > MAX_TARGET_LENGTH) return null;
  let target: URL;
  try {
    target = new URL(rawTarget);
  } catch {
    return null;
  }
  if (target.protocol !== 'exp:' && target.protocol !== 'exps:') return null;
  if (target.username !== '' || target.password !== '' || target.search !== '' || target.hash !== '') return null;
  if (!HOST_PATTERN.test(target.hostname)) return null;
  if (target.pathname.toLowerCase() !== `/--/post/${postId}`) return null;
  return target.href;
}

export function handlePostLinkRequest(request: Request, options: PostLinkOptions): Response {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return text(405, 'Method not allowed.', { Allow: 'GET, HEAD' });
  }
  const url = new URL(request.url);
  const rawPostId = PATH_PATTERN.exec(url.pathname)?.[1] ?? '';
  if (!UUID_PATTERN.test(rawPostId)) return text(404, 'Enlace no válido.');
  const postId = rawPostId.toLowerCase();

  const location = (options.expoGoRedirects ? expoGoTarget(url.searchParams.get('to'), postId) : null) ??
    `${APP_SCHEME}://post/${postId}`;
  return text(302, 'Abriendo la publicación en la app…', { Location: location });
}

export default {
  fetch: (request: Request): Response => handlePostLinkRequest(request, {
    expoGoRedirects: Deno.env.get('POST_LINK_EXPO_GO_REDIRECTS') === 'enabled',
  }),
};
