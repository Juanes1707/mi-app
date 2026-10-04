import { isFeedPostResponseDto } from '@/features/feed/data/dto/feed-page-response';
import { mapFeedPostDtoToDomain } from '@/features/feed/data/mappers/feed-page-mapper';
import type { FeedPost } from '@/features/feed/domain/entities/feed-post';

const RESPONSE_FIELDS = new Set(['post']);

export function parsePostDetailResponse(value: unknown, expectedPostId: string): FeedPost | null {
  if (!isRecord(value) || !hasExactFields(value, RESPONSE_FIELDS) ||
      !isFeedPostResponseDto(value.post) || value.post.id.toLowerCase() !== expectedPostId) {
    return null;
  }

  return mapFeedPostDtoToDomain(value.post);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}
