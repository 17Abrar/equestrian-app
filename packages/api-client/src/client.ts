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
  /**
   * Hook called when a request fails — invoked for both network errors
   * (fetch threw) and shape errors (server returned a body that didn't
   * match the API envelope). Mobile callers wire this to
   * `Sentry.captureException` so the silent-toast pattern in
   * apps/mobile/hooks/use-booking-payment.ts has visibility (audit D-8).
   * Web callers can pass undefined since their fetchJson uses Sentry
   * directly via reportMutationError.
   */
  onError?: (error: unknown, context: { code: string; path: string }) => void;
}

/**
 * Verifies a parsed JSON value matches the `ApiResponse<unknown>` envelope
 * shape: either `{ success: true, data }` or
 * `{ success: false, error: { code, message } }`. Returns a normalised
 * envelope or `null` if the body doesn't match. Without this, a server
 * misconfiguration (HTML error page, gateway timeout, non-JSON body) would
 * cast straight to `ApiResponse<T>` and the consumer would dereference
 * undefined fields. Mobile callers see a clean `NETWORK_ERROR` instead.
 */
function parseEnvelope<T>(raw: unknown): ApiResponse<T> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.success === true) {
    return { success: true, data: obj.data as T };
  }
  if (obj.success === false) {
    const err = obj.error;
    if (typeof err === 'object' && err !== null) {
      const e = err as Record<string, unknown>;
      const code = typeof e.code === 'string' ? e.code : 'UNKNOWN_ERROR';
      const message = typeof e.message === 'string' ? e.message : 'Request failed';
      return { success: false, error: { code, message, details: e.details } };
    }
    return {
      success: false,
      error: { code: 'UNKNOWN_ERROR', message: 'Request failed' },
    };
  }
  return null;
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

      const raw: unknown = await response.json();
      const envelope = parseEnvelope<T>(raw);
      if (!envelope) {
        config.onError?.(
          new Error(`Invalid response shape from ${path}`),
          { code: 'INVALID_RESPONSE', path },
        );
        return {
          success: false,
          error: {
            code: 'INVALID_RESPONSE',
            message: 'Server returned an unexpected response shape',
          },
        };
      }
      return envelope;
    } catch (error) {
      config.onError?.(error, { code: 'NETWORK_ERROR', path });
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
