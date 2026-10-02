import { backendApiClient } from '@/infrastructure/api/backend-api-client';

export type BackendHealthResponse = {
  status: 'ok';
  service: 'instagram-mobile-backend';
  timestamp: string;
};

export function getBackendHealth(): Promise<BackendHealthResponse> {
  return backendApiClient.get<BackendHealthResponse>('/health');
}
