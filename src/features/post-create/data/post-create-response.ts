import type { PostMediaUploadTicket, PublishedPost } from '@/features/post-create/domain/models';
import { PostCreateError } from '@/features/post-create/domain/post-create-error';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}
function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

export function parseUploadTicket(value: unknown): PostMediaUploadTicket {
  if (!isRecord(value) || !isRecord(value.upload)) throw new PostCreateError('invalid-response');
  const dto = value.upload;
  if (dto.bucket !== 'post-media' || !isText(dto.path) || !isText(dto.token)) {
    throw new PostCreateError('invalid-response');
  }
  return { bucket: dto.bucket, path: dto.path, token: dto.token };
}

export function parsePublishedPost(value: unknown, imagePath: string): PublishedPost {
  if (!isRecord(value) || !isRecord(value.post)) throw new PostCreateError('invalid-response');
  const dto = value.post;
  if (!isText(dto.id) || !isText(dto.authorId) || !isText(dto.imagePath) ||
    dto.imagePath !== imagePath || typeof dto.caption !== 'string' || !isTimestamp(dto.createdAt)) {
    throw new PostCreateError('invalid-response');
  }
  return { id: dto.id, authorId: dto.authorId, imagePath: dto.imagePath,
    caption: dto.caption, createdAt: dto.createdAt };
}
