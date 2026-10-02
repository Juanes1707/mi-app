import { authenticatedBackendApiClient } from '@/infrastructure/api/backend-api-container';

export type BackendAuthCheckResponse = {
  authenticated: true;
  userId: string;
};

export function checkBackendAuthentication(): Promise<BackendAuthCheckResponse> {
  return authenticatedBackendApiClient.get<BackendAuthCheckResponse>('/auth-check');
}
