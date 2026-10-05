import { normalizeUuid } from '@/shared/domain/uuid';

// The app link the operating system hands to the installed app (Expo Router opens
// /post/[postId]). Declared in app.json `scheme`.
export function buildPostDeepLink(postId: string): string | null {
  const normalizedPostId = normalizeUuid(postId);
  return normalizedPostId === null ? null : `instagramclone://post/${normalizedPostId}`;
}

// What is actually shared. Messaging apps only make http(s) links tappable, so the
// link points to the public `post-link` Edge Function, which redirects to the app
// link. Inside Expo Go the app has no scheme of its own: `expoGoAppUrl` is this dev
// server's link to the Post (exp://<host>/--/post/{uuid}) and travels as `to`.
export function buildPostShareLink(
  backendBaseUrl: string,
  postId: string,
  expoGoAppUrl: string | null,
): string | null {
  const normalizedPostId = normalizeUuid(postId);
  if (normalizedPostId === null) return null;
  const link = `${backendBaseUrl.trim().replace(/\/+$/, '')}/post-link/${normalizedPostId}`;
  return expoGoAppUrl === null ? link : `${link}?to=${encodeURIComponent(expoGoAppUrl)}`;
}
