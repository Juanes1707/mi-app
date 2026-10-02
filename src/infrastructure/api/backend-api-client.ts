export type BackendApiErrorCode = 'network' | 'timeout' | 'http' | 'invalid-json';

export class BackendApiError extends Error {
  constructor(
    message: string,
    readonly code: BackendApiErrorCode,
    readonly status?: number,
    readonly backendCode?: string,
  ) {
    super(message);
    this.name = 'BackendApiError';
  }
}

export type BackendApiRequestOptions = {
  accessToken?: string;
  timeoutMs?: number;
};

type BackendRequest = BackendApiRequestOptions & {
  method: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
};

const DEFAULT_TIMEOUT_MS = 10_000;

export class BackendApiClient {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    this.baseUrl = this.normalizeBaseUrl(baseUrl);
  }

  get<TResponse>(path: string, options?: BackendApiRequestOptions): Promise<TResponse> {
    return this.request<TResponse>(path, {
      method: 'GET',
      ...options,
    });
  }

  post<TResponse, TBody>(
    path: string,
    body: TBody,
    options?: BackendApiRequestOptions,
  ): Promise<TResponse> {
    return this.request<TResponse>(path, {
      method: 'POST',
      body,
      ...options,
    });
  }

  patch<TResponse, TBody>(
    path: string,
    body: TBody,
    options?: BackendApiRequestOptions,
  ): Promise<TResponse> {
    return this.request<TResponse>(path, {
      method: 'PATCH',
      body,
      ...options,
    });
  }

  private async request<TResponse>(path: string, request: BackendRequest): Promise<TResponse> {
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (request.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (request.accessToken) {
      headers.Authorization = `Bearer ${request.accessToken}`;
    }

    try {
      const response = await fetch(this.buildUrl(path), {
        method: request.method,
        headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const backendCode = await this.readBackendErrorCode(response);

        throw new BackendApiError(
          `Backend request failed with HTTP ${response.status} ${response.statusText}.`,
          'http',
          response.status,
          backendCode,
        );
      }

      const contentType = response.headers.get('content-type') ?? '';

      if (!contentType.toLowerCase().includes('application/json')) {
        throw new BackendApiError(
          'Backend response did not contain JSON as expected.',
          'invalid-json',
          response.status,
        );
      }

      try {
        return (await response.json()) as TResponse;
      } catch {
        throw new BackendApiError(
          'Backend response contained invalid JSON.',
          'invalid-json',
          response.status,
        );
      }
    } catch (error: unknown) {
      if (error instanceof BackendApiError) {
        throw error;
      }

      if (controller.signal.aborted) {
        throw new BackendApiError(
          `Backend request timed out after ${timeoutMs} ms.`,
          'timeout',
        );
      }

      const detail = error instanceof Error ? ` ${error.message}` : '';
      throw new BackendApiError(`Backend network request failed.${detail}`, 'network');
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) {
      throw new Error('Backend request paths must be relative.');
    }

    const normalizedPath = path.replace(/^\/+/, '');
    return normalizedPath ? `${this.baseUrl}/${normalizedPath}` : this.baseUrl;
  }

  private async readBackendErrorCode(response: Response): Promise<string | undefined> {
    try {
      const body: unknown = await response.json();

      if (
        typeof body !== 'object' ||
        body === null ||
        Array.isArray(body) ||
        !('code' in body) ||
        typeof body.code !== 'string' ||
        !/^[a-z0-9_]{1,64}$/.test(body.code)
      ) {
        return undefined;
      }

      return body.code;
    } catch {
      return undefined;
    }
  }

  private normalizeBaseUrl(baseUrl: string): string {
    const normalizedUrl = baseUrl.trim().replace(/\/+$/, '');

    if (!/^https?:\/\/[^\s]+$/i.test(normalizedUrl)) {
      throw new Error('EXPO_PUBLIC_BACKEND_BASE_URL must be a valid HTTP or HTTPS URL.');
    }

    return normalizedUrl;
  }
}

function getBackendBaseUrl(): string {
  const baseUrl = process.env.EXPO_PUBLIC_BACKEND_BASE_URL;

  if (!baseUrl) {
    throw new Error(
      'Backend configuration is missing: EXPO_PUBLIC_BACKEND_BASE_URL. ' +
        'Copy .env.example to .env and complete the required variable.',
    );
  }

  return baseUrl;
}

export const backendApiClient = new BackendApiClient(getBackendBaseUrl());
