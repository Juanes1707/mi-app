import type { ProfileViewResponseDto } from '@/features/profile-view/data/dto/profile-view-response';
import type { ViewedProfile } from '@/features/profile-view/domain/entities/viewed-profile';
import type { ProfileRelationship } from '@/features/profile-view/domain/models/profile-relationship';

export function mapProfileViewResponseDtoToDomain(
  dto: ProfileViewResponseDto,
): ViewedProfile {
  return {
    id: dto.profile.id,
    username: dto.profile.username,
    displayName: dto.profile.displayName,
    avatarUrl: dto.profile.avatarUrl,
    bio: dto.profile.bio,
    isPrivate: dto.profile.isPrivate,
    isSelf: dto.isSelf,
    relationship: mapRelationshipToDomain(dto.relationship),
  };
}

function mapRelationshipToDomain(
  relationship: ProfileViewResponseDto['relationship'],
): ProfileRelationship {
  if (relationship.status === 'request_pending') {
    return {
      status: 'request-pending',
      requestId: relationship.requestId,
    };
  }

  return { status: relationship.status };
}
