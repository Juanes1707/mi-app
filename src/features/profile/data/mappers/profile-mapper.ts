import type { ProfileDto } from '@/features/profile/data/dto/profile-me-response';
import type { Profile } from '@/features/profile/domain/entities/profile';

export function mapProfileDtoToDomain(dto: ProfileDto): Profile {
  return {
    id: dto.id,
    username: dto.username,
    displayName: dto.displayName,
    avatarUrl: dto.avatarUrl,
    bio: dto.bio,
    isPrivate: dto.isPrivate,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}
