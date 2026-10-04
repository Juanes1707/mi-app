import { parseProfileConnectionsPage } from '@/features/profile-connections/data/profile-connections-response';
import type {
  ProfileConnectionKind, ProfileConnectionsCursor, ProfileConnectionsPage,
} from '@/features/profile-connections/domain/profile-connection';
import { ProfileConnectionsError } from '@/features/profile-connections/domain/profile-connections-error';
import type { ProfileConnectionsRepository } from '@/features/profile-connections/domain/profile-connections-repository';
import {
  AuthenticatedBackendApiClient, AuthenticatedUserMismatchError, AuthenticationRequiredError,
} from '@/infrastructure/api/authenticated-backend-api-client';
import { BackendApiError } from '@/infrastructure/api/backend-api-client';

export class BackendProfileConnectionsRepository implements ProfileConnectionsRepository {
  constructor(private readonly client: AuthenticatedBackendApiClient) {}

  async getPage(
    owner: string,
    target: string,
    kind: ProfileConnectionKind,
    limit: number,
    cursor: ProfileConnectionsCursor | null,
  ): Promise<ProfileConnectionsPage> {
    const params = new URLSearchParams({ userId: target, kind, limit: String(limit) });
    if (cursor !== null) {
      params.set('beforeCreatedAt', cursor.connectedAt);
      params.set('beforeUserId', cursor.userId);
    }
    let response: unknown;
    try {
      response = await this.client.getAsUser<unknown>(owner, `/profile-connections?${params}`);
    } catch (error: unknown) {
      throw mapError(error);
    }
    const page = parseProfileConnectionsPage(response, { limit, cursor });
    if (page === null) throw new ProfileConnectionsError('invalid-response');
    return page;
  }
}

function mapError(error: unknown): ProfileConnectionsError {
  if (error instanceof ProfileConnectionsError) return error;
  if (error instanceof AuthenticatedUserMismatchError) {
    return new ProfileConnectionsError('owner-session-mismatch');
  }
  if (error instanceof AuthenticationRequiredError) {
    return new ProfileConnectionsError('authentication-required');
  }
  if (!(error instanceof BackendApiError)) return new ProfileConnectionsError('unavailable');
  if (error.code === 'invalid-json') return new ProfileConnectionsError('invalid-response');
  if (error.code !== 'http') return new ProfileConnectionsError('unavailable');
  if (error.status === 401) return new ProfileConnectionsError('authentication-required');
  if (error.status === 400 && error.backendCode === 'invalid_profile_connections_request') {
    return new ProfileConnectionsError('invalid-request');
  }
  if (error.status === 404 && error.backendCode === 'profile_not_found') {
    return new ProfileConnectionsError('profile-not-found');
  }
  if (error.status === 409 && error.backendCode === 'profile_not_ready') {
    return new ProfileConnectionsError('profile-not-ready');
  }
  if (error.backendCode === 'profile_connections_read_failed') {
    return new ProfileConnectionsError('unavailable');
  }
  return new ProfileConnectionsError('unavailable');
}
