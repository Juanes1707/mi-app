import type { FeedCursor, FeedPage } from '@/features/feed/domain/models/feed-page';

export interface FeedRepository {
  getPage(cursor?: FeedCursor | null): Promise<FeedPage>;
}
