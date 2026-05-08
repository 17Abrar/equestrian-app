import { type z } from 'zod';
import { type ApiResponse, type PaginatedApiResponse } from '@equestrian/shared/types';

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Audit F-69 companion (2026-05-08 r6): per-route response validation.
 * Pass `validate: <ZodSchema>` (the schema for the resolved `data`
 * field, NOT the envelope) and the client runs `.safeParse(data)` after
 * the envelope check passes. A schema mismatch surfaces the same
 * `INVALID_RESPONSE` code the existing envelope-shape check uses, so
 * existing consumers handle it transparently — but `onError` now
 * carries the parse-issue list so Sentry/console capture exactly which
 * field drifted.
 *
 * Migration note: the field is optional on every method. Adding a
 * schema to one hook never forces a flag day across the rest. Start
 * with the highest-traffic shapes (horse list, booking list) and
 * extend incrementally — that's how Alpha-2's type consolidation
 * landed and the same pacing applies here.
 */
type ResponseSchema<T> = z.ZodType<T>;

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
 *
 * Boundary contract (audit F-68, NIT, accepted): we shape-check that
 * `success` is a boolean and that `error.code` / `error.message` are
 * strings, but `obj.data` is cast to `T` without per-route Zod validation.
 * The cast is the documented boundary — per-route response schemas would
 * give us full runtime type checking, but wiring them across every endpoint
 * is intentionally deferred to a future api-client refactor PR. Until then,
 * the consumer is responsible for treating `data` as defensively as it
 * treats any external input (e.g. don't deref nested fields without
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
  async function request<T>(
    path: string,
    options: FetchOptions & { validate?: ResponseSchema<T> } = {},
  ): Promise<ApiResponse<T>> {
    const { method = 'GET', body, headers = {}, signal, validate } = options;

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
      // Audit F-69 companion: when the caller passed a per-route
      // schema, validate the resolved `data` against it. The envelope
      // already passed shape-check so we only run on the success
      // branch. Parse failures collapse to the same INVALID_RESPONSE
      // code the envelope mismatch uses — consumers don't need a new
      // error path — but `onError` carries the issue list so Sentry /
      // console capture pinpoints which field drifted.
      if (envelope.success && validate) {
        const parsed = validate.safeParse(envelope.data);
        if (!parsed.success) {
          config.onError?.(parsed.error, { code: 'INVALID_RESPONSE', path });
          return {
            success: false,
            error: {
              code: 'INVALID_RESPONSE',
              message: 'Server returned data that did not match the expected schema',
            },
          };
        }
        return { success: true, data: parsed.data };
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

  /**
   * Audit F-6 / F-7 (2026-05-07 r5 PR Sigma): paginated GET that returns the
   * `PaginatedApiResponse<T>` discriminated union directly, replacing the
   * `as never as Promise<…>` double cast that previously had to live at every
   * mobile hook. Use this instead of `get<T>` whenever the route returns a
   * `paginatedResponse(...)` envelope (page/pageSize/total/totalPages).
   */
  async function requestPaginated<T>(
    path: string,
    options: FetchOptions & { validate?: ResponseSchema<T> } = {},
  ): Promise<PaginatedApiResponse<T>> {
    const { method = 'GET', body, headers = {}, signal, validate } = options;

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
      const envelope = parsePaginatedEnvelope<T>(raw);
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
      // Audit F-69 companion: validate every item in `data` against
      // the per-route schema when supplied. Same INVALID_RESPONSE
      // collapse + onError telemetry as the non-paginated path.
      if (envelope.success && validate) {
        const validatedItems: T[] = [];
        for (const item of envelope.data) {
          const parsed = validate.safeParse(item);
          if (!parsed.success) {
            config.onError?.(parsed.error, { code: 'INVALID_RESPONSE', path });
            return {
              success: false,
              error: {
                code: 'INVALID_RESPONSE',
                message: 'Server returned data that did not match the expected schema',
              },
            };
          }
          validatedItems.push(parsed.data);
        }
        return { success: true, data: validatedItems, pagination: envelope.pagination };
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
    get: <T>(
      path: string,
      options?: Omit<FetchOptions, 'method' | 'body'> & { validate?: ResponseSchema<T> },
    ) => request<T>(path, { ...options, method: 'GET' }),

    getPaginated: <T>(
      path: string,
      options?: Omit<FetchOptions, 'method' | 'body'> & { validate?: ResponseSchema<T> },
    ) => requestPaginated<T>(path, { ...options, method: 'GET' }),

    post: <T>(
      path: string,
      body?: unknown,
      options?: Omit<FetchOptions, 'method' | 'body'> & { validate?: ResponseSchema<T> },
    ) => request<T>(path, { ...options, method: 'POST', body }),

    put: <T>(
      path: string,
      body?: unknown,
      options?: Omit<FetchOptions, 'method' | 'body'> & { validate?: ResponseSchema<T> },
    ) => request<T>(path, { ...options, method: 'PUT', body }),

    patch: <T>(
      path: string,
      body?: unknown,
      options?: Omit<FetchOptions, 'method' | 'body'> & { validate?: ResponseSchema<T> },
    ) => request<T>(path, { ...options, method: 'PATCH', body }),

    delete: <T>(
      path: string,
      options?: Omit<FetchOptions, 'method' | 'body'> & { validate?: ResponseSchema<T> },
    ) => request<T>(path, { ...options, method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
