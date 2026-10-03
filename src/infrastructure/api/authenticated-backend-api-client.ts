import type { AccessTokenProvider } from '@/features/auth/application/ports/access-token-provider';
import {
  BackendApiClient,
  type BackendApiRequestOptions,
} from '@/infrastructure/api/backend-api-client';
import { readUnverifiedJwtSubject } from '@/infrastructure/api/jwt-subject';

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

// The session's token belongs to a different user than the one the request was
// bound to (e.g. account switched while queued work was being replayed).
export class AuthenticatedUserMismatchError extends Error {
  constructor() {
    super('The current session does not belong to the expected user.');
    this.name = 'AuthenticatedUserMismatchError';
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

  // PUT bound to an expected user (see requireAccessTokenFor).
  async putAsUser<TResponse, TBody>(
    expectedUserId: string,
    path: string,
    body: TBody,
    options?: AuthenticatedBackendRequestOptions,
  ): Promise<TResponse> {
    const accessToken = await this.requireAccessTokenFor(expectedUserId);

    return this.backendApiClient.put<TResponse, TBody>(path, body, {
      ...options,
      accessToken,
    });
  }

  // POST bound to an expected user (see requireAccessTokenFor).
  async postAsUser<TResponse, TBody>(
    expectedUserId: string,
    path: string,
    body: TBody,
    options?: AuthenticatedBackendRequestOptions,
  ): Promise<TResponse> {
    const accessToken = await this.requireAccessTokenFor(expectedUserId);

    return this.backendApiClient.post<TResponse, TBody>(path, body, {
      ...options,
      accessToken,
    });
  }

  // The token is read ONCE, its subject is checked against `expectedUserId`, and the
  // caller sends that very same token. There is no second token lookup in which a
  // different session could slip in. The expected user is never sent: the backend
  // still derives the actor from the verified JWT.
  private async requireAccessTokenFor(expectedUserId: string): Promise<string> {
    const accessToken = await this.requireAccessToken();
    const subject = readUnverifiedJwtSubject(accessToken);

    if (subject === null) {
      throw new AuthenticationRequiredError();
    }

    if (subject !== expectedUserId.toLowerCase()) {
      throw new AuthenticatedUserMismatchError();
    }

    return accessToken;
  }

  private async requireAccessToken(): Promise<string> {
    const accessToken = await this.accessTokenProvider.getAccessToken();

    if (!accessToken) {
      throw new AuthenticationRequiredError();
    }

    return accessToken;
  }
}
