import type { AccessTokenProvider } from '@/features/auth/application/ports/access-token-provider';
import {
  BackendApiClient,
  type BackendApiRequestOptions,
} from '@/infrastructure/api/backend-api-client';

export type AuthenticatedBackendRequestOptions = Omit<
  BackendApiRequestOptions,
  'accessToken'
>;

export class AuthenticationRequiredError extends Error {
  constructor() {
    super('An authenticated session is required to call this backend operation.');
    this.name = 'AuthenticationRequiredError';
  }
}

export class AuthenticatedBackendApiClient {
  constructor(
    private readonly backendApiClient: BackendApiClient,
    private readonly accessTokenProvider: AccessTokenProvider,
  ) {}

  async get<TResponse>(
    path: string,
    options?: AuthenticatedBackendRequestOptions,
  ): Promise<TResponse> {
    const accessToken = await this.requireAccessToken();

    return this.backendApiClient.get<TResponse>(path, {
      ...options,
      accessToken,
    });
  }

  async post<TResponse, TBody>(
    path: string,
    body: TBody,
    options?: AuthenticatedBackendRequestOptions,
  ): Promise<TResponse> {
    const accessToken = await this.requireAccessToken();

    return this.backendApiClient.post<TResponse, TBody>(path, body, {
      ...options,
      accessToken,
    });
  }

  async patch<TResponse, TBody>(
    path: string,
    body: TBody,
    options?: AuthenticatedBackendRequestOptions,
  ): Promise<TResponse> {
    const accessToken = await this.requireAccessToken();

    return this.backendApiClient.patch<TResponse, TBody>(path, body, {
      ...options,
      accessToken,
    });
  }

  private async requireAccessToken(): Promise<string> {
    const accessToken = await this.accessTokenProvider.getAccessToken();

    if (!accessToken) {
      throw new AuthenticationRequiredError();
    }

    return accessToken;
  }
}
