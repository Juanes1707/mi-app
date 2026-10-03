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
