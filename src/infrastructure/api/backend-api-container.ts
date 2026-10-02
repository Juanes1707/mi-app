import { SupabaseAccessTokenProvider } from '@/features/auth/data/providers/supabase-access-token-provider';
import { backendApiClient } from '@/infrastructure/api/backend-api-client';
import { AuthenticatedBackendApiClient } from '@/infrastructure/api/authenticated-backend-api-client';

const accessTokenProvider = new SupabaseAccessTokenProvider();

export const authenticatedBackendApiClient = new AuthenticatedBackendApiClient(
  backendApiClient,
  accessTokenProvider,
);
