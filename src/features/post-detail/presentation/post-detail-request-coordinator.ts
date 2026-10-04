import type { FeedPost } from '@/features/feed/domain/entities/feed-post';
import { PostDetailError, type PostDetailErrorCode } from '@/features/post-detail/domain/post-detail-error';

export type PostDetailState =
  | { postId: string; status: 'loading' }
  | { postId: string; status: 'loaded'; post: FeedPost; isRefreshing: boolean; refreshError: PostDetailErrorCode | null }
  | { postId: string; status: 'not-found' }
  | { postId: string; status: 'profile-not-ready' }
  | { postId: string; status: 'error'; error: PostDetailErrorCode };

export type PostReader = { execute(postId: string): Promise<FeedPost> };

function errorCode(error: unknown): PostDetailErrorCode {
  return error instanceof PostDetailError ? error.code : 'unavailable';
}

export class PostDetailRequestCoordinator {
  private active = true;
  private generation = 0;
  private current: PostDetailState;

  constructor(
    private readonly reader: PostReader,
    initialPostId: string,
    private readonly publish: (state: PostDetailState) => void,
  ) {
    this.current = { postId: initialPostId, status: 'loading' };
  }

  load(postId: string): void {
    if (!this.active) return;
    const generation = ++this.generation;
    this.setCurrent({ postId, status: 'loading' });
    void this.reader.execute(postId).then(
      (post) => {
        if (!this.isCurrent(generation)) return;
        this.setCurrent({ postId, status: 'loaded', post, isRefreshing: false, refreshError: null });
      },
      (error: unknown) => {
        if (!this.isCurrent(generation)) return;
        const code = errorCode(error);
        if (code === 'post-not-found') {
          this.setCurrent({ postId, status: 'not-found' });
        } else if (code === 'profile-not-ready') {
          this.setCurrent({ postId, status: 'profile-not-ready' });
        } else {
          this.setCurrent({ postId, status: 'error', error: code });
        }
      },
    );
  }

  retry(): void {
    if (this.active) this.load(this.current.postId);
  }

  refresh(): void {
    if (!this.active || this.current.status !== 'loaded' || this.current.isRefreshing) return;
    const generation = ++this.generation;
    const previous = this.current;
    this.setCurrent({ ...previous, isRefreshing: true, refreshError: null });
    void this.reader.execute(previous.postId).then(
      (post) => {
        if (!this.isCurrent(generation)) return;
        this.setCurrent({
          postId: previous.postId, status: 'loaded', post, isRefreshing: false, refreshError: null,
        });
      },
      (error: unknown) => {
        if (!this.isCurrent(generation)) return;
        const code = errorCode(error);
        if (code === 'post-not-found') {
          this.setCurrent({ postId: previous.postId, status: 'not-found' });
        } else if (code === 'profile-not-ready') {
          this.setCurrent({ postId: previous.postId, status: 'profile-not-ready' });
        } else {
          this.setCurrent({ ...previous, isRefreshing: false, refreshError: code });
        }
      },
    );
  }

  dispose(): void {
    this.active = false;
    this.generation += 1;
  }

  private isCurrent(generation: number): boolean {
    return this.active && this.generation === generation;
  }

  private setCurrent(state: PostDetailState): void {
    this.current = state;
    this.publish(state);
  }
}
