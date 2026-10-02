import type { DiscoveredProfile } from '@/features/explore/domain/entities/discovered-profile';
import { ProfileSearchError } from '@/features/explore/domain/errors/profile-search-error';
import type { ProfileSearchRepository } from '@/features/explore/domain/repositories/profile-search-repository';

export class SearchProfiles {
  constructor(private readonly profileSearchRepository: ProfileSearchRepository) {}

  execute(query: string): Promise<DiscoveredProfile[]> {
    const normalizedQuery = query.trim();
    const queryLength = [...normalizedQuery].length;

    if (queryLength === 0 || queryLength > 50) {
      throw new ProfileSearchError('invalid-query');
    }

    return this.profileSearchRepository.searchProfiles(normalizedQuery);
  }
}
