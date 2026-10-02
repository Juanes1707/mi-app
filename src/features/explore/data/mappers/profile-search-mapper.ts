import type { ProfileSearchResponseDto } from '@/features/explore/data/dto/profile-search-response';
import type { DiscoveredProfile } from '@/features/explore/domain/entities/discovered-profile';

export function mapProfileSearchResponseDtoToDomain(
  dto: ProfileSearchResponseDto,
): DiscoveredProfile[] {
  return dto.profiles.map((profile) => ({
    id: profile.id,
    username: profile.username,
    displayName: profile.displayName,
    isPrivate: profile.isPrivate,
  }));
}
