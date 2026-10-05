import type { ViewToken } from 'react-native';

import type { FeedPost } from '@/features/feed/domain/entities/feed-post';

// Derives the set of posts whose media may load. Returns `previous` when nothing
// changed so the list does not re-render cells for an identical viewport.
export function collectVisiblePostIds(
  viewableItems: readonly ViewToken<FeedPost>[],
  previous: ReadonlySet<string>,
): ReadonlySet<string> {
  const next = new Set<string>();
  for (const token of viewableItems) {
    if (token.isViewable) next.add(token.item.id);
  }
  if (next.size === previous.size && [...next].every((id) => previous.has(id))) return previous;
  return next;
}

// Rows allowed to hold a decoded bitmap: every visible post plus `neighbors` posts
// before and after the visible range, so an image is restored from RAM just before
// it scrolls back in. Every other mounted row drops its bitmap, which bounds decoded
// memory by the viewport instead of by how many rows the list keeps mounted.
export function collectRetainedPostIds(
  posts: readonly { id: string }[],
  visiblePostIds: ReadonlySet<string>,
  neighbors: number,
): ReadonlySet<string> {
  const retained = new Set<string>();
  if (visiblePostIds.size === 0) return retained;
  let first = -1;
  let last = -1;
  posts.forEach((post, index) => {
    if (!visiblePostIds.has(post.id)) return;
    if (first < 0) first = index;
    last = index;
  });
  if (first < 0) return retained;
  const end = Math.min(posts.length - 1, last + neighbors);
  for (let index = Math.max(0, first - neighbors); index <= end; index += 1) {
    const post = posts[index];
    if (post !== undefined) retained.add(post.id);
  }
  return retained;
}
