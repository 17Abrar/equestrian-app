import type { z } from 'zod';
import { type ApiResponse, type PaginatedApiResponse } from '@equestrian/shared/types';

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /**
   * Audit F-69 (2026-05-08 r6 PR Alpha-2): optional Zod schema run against
   * `envelope.data` after the shape-check in `parseEnvelope`. When supplied,
   * a parse failure is reported through `onError` and surfaced as a normal
   * `INVALID_RESPONSE` error envelope so callers don't need to introduce a
   * second error path. Schema is optional because we're rolling per-route
   * schemas out incrementally — until every route in `apps/web/app/api/v1`
   * has one declared in `packages/shared/src/schemas/responses/`, callers
   * that don't pass a schema fall back to the existing typed-cast contract.
   */
  schema?: z.ZodTypeAny;
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

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function createRequestSignal(callerSignal?: AbortSignal): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  if (callerSignal?.aborted) {
    return { signal: callerSignal, cleanup: () => undefined };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();

  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

/**
 * Verifies a parsed JSON value matches the `ApiResponse<unknown>` envelope
 * shape: either `{ success: true, data }` or
 * `{ success: false, error: { code, message } }`. Returns a normalised
 * envelope or `null` if the body doesn't match. Without this, a server
 * misconfiguration (HTML error page, gateway timeout, non-JSON body) would
 * cast straight to `ApiResponse<T>` and the consumer would dereference
 * undefined fields. Mobile callers see a clean `NETWORK_ERROR` instead.
 *
 * Boundary contract (audit F-68, NIT, accepted; F-69, NIT, partial 2026-05-08
 * r6): we shape-check that `success` is a boolean and that `error.code` /
 * `error.message` are strings, but `obj.data` is cast to `T` without per-route
 * Zod validation. F-69 introduced the `schema?: z.ZodTypeAny` option on
 * `get`/`getPaginated`/`post`/`patch`/`put`/`delete` — when supplied, the
 * caller's per-route schema runs against `envelope.data`. Until every route
 * has a corresponding schema declared in
 * `packages/shared/src/schemas/responses/`, callers that don't pass a schema
 * fall back to this typed-cast boundary; consumers should treat `data` as
 * defensively as any other external input (don't deref nested fields without
 * narrowing).
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

/**
 * Sibling of `parseEnvelope` for the paginated envelope shape:
 * `{ success: true, data: T[], pagination: { page, pageSize, total, totalPages } }`
 * or the same error shape as the non-paginated envelope. Same per-route
 * Zod-validation boundary caveat as `parseEnvelope` (audit F-68).
 */
function parsePaginatedEnvelope<T>(raw: unknown): PaginatedApiResponse<T> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.success === true) {
    if (!Array.isArray(obj.data)) return null;
    const pagination = obj.pagination;
    if (typeof pagination !== 'object' || pagination === null) return null;
    const p = pagination as Record<string, unknown>;
    const page = typeof p.page === 'number' ? p.page : null;
    const pageSize = typeof p.pageSize === 'number' ? p.pageSize : null;
    const total = typeof p.total === 'number' ? p.total : null;
    const totalPages = typeof p.totalPages === 'number' ? p.totalPages : null;
    if (page === null || pageSize === null || total === null || totalPages === null) {
      return null;
    }
    return {
      success: true,
      data: obj.data as T[],
      pagination: { page, pageSize, total, totalPages },
    };
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
    const { method = 'GET', body, headers = {}, signal, schema } = options;

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

    const requestSignal = createRequestSignal(signal);

    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: requestSignal.signal,
      });

      const raw: unknown = await response.json().catch(() => null);
      const envelope = parseEnvelope<T>(raw);
      if (!response.ok) {
        config.onError?.(
          new Error(`HTTP ${response.status} from ${path}`),
          { code: `HTTP_${response.status}`, path },
        );
        if (envelope) return envelope;
        return {
          success: false,
          error: {
            code: `HTTP_${response.status}`,
            message: response.statusText || 'Request failed',
          },
        };
      }
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
      // Audit F-69: per-route schema validation. Only runs on success
      // envelopes — error envelopes are already shape-checked above.
      if (envelope.success && schema) {
        const parsed = schema.safeParse(envelope.data);
        if (!parsed.success) {
          config.onError?.(parsed.error, { code: 'INVALID_RESPONSE', path });
          return {
            success: false,
            error: {
              code: 'INVALID_RESPONSE',
              message: 'Server response failed validation',
              details: parsed.error.flatten(),
            },
          };
        }
        return { success: true, data: parsed.data as T };
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
    } finally {
      requestSignal.cleanup();
    }
  }

  /**
   * Audit F-6 / F-7 (2026-05-07 r5 PR Sigma): paginated GET that returns the
   * `PaginatedApiResponse<T>` discriminated union directly, replacing the
   * `as never as Promise<…>` double cast that previously had to live at every
   * mobile hook. Use this instead of `get<T>` whenever the route returns a
   * `paginatedResponse(...)` envelope (page/pageSize/total/totalPages).
   */
  async function requestPaginated<T>(
    path: string,
    options: FetchOptions = {},
  ): Promise<PaginatedApiResponse<T>> {
    const { method = 'GET', body, headers = {}, signal, schema } = options;

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

    const requestSignal = createRequestSignal(signal);

    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        method,
        headers: requestHeaders,
        body: body ? JSON.stringify(body) : undefined,
        signal: requestSignal.signal,
      });

      const raw: unknown = await response.json().catch(() => null);
      const envelope = parsePaginatedEnvelope<T>(raw);
      if (!response.ok) {
        config.onError?.(
          new Error(`HTTP ${response.status} from ${path}`),
          { code: `HTTP_${response.status}`, path },
        );
        if (envelope) return envelope;
        return {
          success: false,
          error: {
            code: `HTTP_${response.status}`,
            message: response.statusText || 'Request failed',
          },
        };
      }
      if (!envelope) {
        config.onError?.(
          new Error(`Invalid paginated response shape from ${path}`),
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
      // Audit F-69: per-route schema validation. The schema validates a
      // single row (not the array), matching how the audit calls for
      // `apiClient.get<T>(path, schema)` to validate the inner shape.
      if (envelope.success && schema) {
        const parsed = schema.array().safeParse(envelope.data);
        if (!parsed.success) {
          config.onError?.(parsed.error, { code: 'INVALID_RESPONSE', path });
          return {
            success: false,
            error: {
              code: 'INVALID_RESPONSE',
              message: 'Server response failed validation',
              details: parsed.error.flatten(),
            },
          };
        }
        return {
          success: true,
          data: parsed.data as T[],
          pagination: envelope.pagination,
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
    } finally {
      requestSignal.cleanup();
    }
  }

  return {
    get: <T>(path: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'GET' }),

    getPaginated: <T>(path: string, options?: Omit<FetchOptions, 'method' | 'body'>) =>
      requestPaginated<T>(path, { ...options, method: 'GET' }),

    post: <T>(path: string, body?: unknown, options?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'POST', body }),

    put: <T>(path: string, body?: unknown, options?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'PUT', body }),

    patch: <T>(path: string, body?: unknown, options?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'PATCH', body }),

    // DELETE accepts an optional body — RFC 9110 permits it and our cancel-
    // booking flow uses it to ship a `cancelBookingSchema`-typed reason.
    // The mobile `useCancelBooking` hook was previously dropping its
    // `reason` parameter on the floor (audit pass-4 M-2) because this
    // method had no body slot.
    delete: <T>(path: string, body?: unknown, options?: Omit<FetchOptions, 'method' | 'body'>) =>
      request<T>(path, { ...options, method: 'DELETE', body }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
