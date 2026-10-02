import type { DiscoveredProfile } from '@/features/explore/domain/entities/discovered-profile';

export interface ProfileSearchRepository {
  searchProfiles(query: string): Promise<DiscoveredProfile[]>;
}
