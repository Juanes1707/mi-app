import type { FeedCursor, FeedPage } from '@/features/feed/domain/models/feed-page';
import type { FeedRepository } from '@/features/feed/domain/repositories/feed-repository';

export class GetFeedPage {
  constructor(private readonly repository: FeedRepository) {}

  execute(cursor: FeedCursor | null = null): Promise<FeedPage> {
    return this.repository.getPage(cursor);
  }
}
