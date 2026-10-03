import type { FeedPost } from '@/features/feed/domain/entities/feed-post';

export type FeedCursor = { createdAt: string; postId: string };
export type FeedPage = { posts: FeedPost[]; nextCursor: FeedCursor | null };
