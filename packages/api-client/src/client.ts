import { type ApiResponse } from '@equestrian/shared/types';

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

interface ApiClientConfig {
  baseUrl: string;
  getToken: () => Promise<string | null>;
  getOrganizationId: () => string | null;
}

export function createApiClient(config: ApiClientConfig) {
  async function request<T>(path: string, options: FetchOptions = {}): Promise<ApiResponse<T>> {
    const { method = 'GET', body, headers = {}, signal } = options;

    const token = await config.getToken();
    const orgId = config.getOrganizationId();

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (token) {
      requestHeaders['Authorization'] = `Bearer ${token}`;
    }

    if (orgId) {
      requestHeaders['X-Organization-Id'] = orgId;
    }

    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal,
      });

      const data = (await response.json()) as ApiResponse<T>;
      return data;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'An unexpected error occurred',
        },
      };
    }
  }

  return {
    get: <T>(path: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'GET' }),

    post: <T>(path: string, body?: unknown, options?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'POST', body }),

    put: <T>(path: string, body?: unknown, options?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'PUT', body }),

    patch: <T>(path: string, body?: unknown, options?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'PATCH', body }),

    delete: <T>(path: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
