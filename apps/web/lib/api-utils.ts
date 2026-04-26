import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { type ZodError, type ZodTypeAny } from 'zod';
import { type UserRole } from '@equestrian/shared/types';
import { getTenantContext, TenantError, type ActiveMembership } from './tenant';
import { hasPermission, PermissionError } from './permissions';
import { logger } from './logger';
import { checkRateLimit, type RateLimitConfig } from './rate-limit';
import { createAuditEntry } from '@equestrian/db/queries';

interface AuditParams {
  action: string;
  resourceType: string;
  resourceId?: string;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

interface ApiHandlerOptions {
  requiredPermission?: string;
  rateLimit?: RateLimitConfig;
  /**
   * Namespaces the rate-limit counter so a user's budget on this route doesn't
   * pool with other routes' budgets. When unset, the limiter keys on userId
   * alone — which means any two routes sharing a config share a counter, so a
   * cheap noisy endpoint can starve an expensive one. Set this on every route
   * that passes an explicit `rateLimit` (the burst-sensitive ones) and on any
   * route where the per-user budget needs isolation.
   */
  routeKey?: string;
}

interface AuthenticatedContext {
  clubId: string;
  memberId: string | null;
  userId: string;
  orgId: string;
  orgRole: UserRole;
  onboardingCompleted: boolean;
  /**
   * All active club memberships for this user, when getTenantContext loaded
   * them as part of resolution. Only populated on the club_members fallback
   * path (Path 2) — Clerk-org-resolved sessions leave this undefined and
   * must call getActiveMembershipsForUser themselves.
   */
  memberships?: ActiveMembership[];
  requestId: string;
  audit: (params: AuditParams) => Promise<void>;
}

export function successResponse<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: unknown,
) {
  return NextResponse.json(
    { success: false, error: { code, message, details } },
    { status },
  );
}

export function paginatedResponse<T>(
  data: T[],
  pagination: { page: number; pageSize: number; total: number },
) {
  return NextResponse.json({
    success: true,
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.pageSize),
    },
  });
}

/**
 * Validates input against a Zod schema. Returns the parsed output type,
 * which includes defaults applied by `.default()` modifiers.
 * Throws ValidationError with flattened details on failure.
 */
export function validateInput<S extends ZodTypeAny>(
  schema: S,
  data: unknown,
): S['_output'] {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(result.error);
  }
  return result.data;
}

/**
 * Parses a JSON request body for routes that accept an optional body
 * (i.e. all schema fields are optional or have defaults). An empty body
 * validates against the schema as `{}`, letting defaults kick in;
 * malformed JSON propagates a `SyntaxError` that `withAuth` renders as
 * `400 INVALID_JSON`.
 *
 * Replaces the ad-hoc `request.json().catch(() => ({}))` pattern which
 * silently swallowed malformed JSON — a caller typo on a refund request
 * would become an unintended full refund because Zod defaults took
 * over. See audit 2026-04-24.
 */
export async function parseOptionalBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<S['_output']> {
  const text = await request.text();
  if (text.length === 0) {
    return validateInput(schema, {});
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SyntaxError('Request body contains invalid JSON');
  }
  return validateInput(schema, raw);
}

export class ValidationError extends Error {
  public readonly code = 'VALIDATION_ERROR';
  public readonly details: unknown;

  constructor(zodError: ZodError) {
    super('Invalid input');
    this.name = 'ValidationError';
    this.details = zodError.flatten();
  }
}

export async function withAuth(
  handler: (ctx: AuthenticatedContext) => Promise<NextResponse>,
  options?: ApiHandlerOptions,
): Promise<NextResponse> {
  try {
    const headerStore = await headers();
    const requestId = headerStore.get('x-request-id') ?? crypto.randomUUID();
    const ip =
      headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headerStore.get('x-real-ip') ??
      'unknown';
    const userAgent = headerStore.get('user-agent') ?? 'unknown';

    const tenantCtx = await getTenantContext();

    // Rate limiting (per user, default 60 req/min). When the caller doesn't
    // pass a routeKey, fall back to the request pathname (set on the
    // headers by middleware) so each route gets its own bucket — without
    // this, all endpoints share a single 60/min budget per user and a
    // 3-tab admin polling 5 endpoints starves itself with spurious 429s.
    // Audit G-21.
    const rateLimitConfig = options?.rateLimit ?? { maxRequests: 60, windowMs: 60_000 };
    const pathname = headerStore.get('x-pathname') ?? '';
    const fallbackKey = pathname ? `${tenantCtx.userId}:${pathname}` : tenantCtx.userId;
    const rateLimitKey = options?.routeKey
      ? `${tenantCtx.userId}:${options.routeKey}`
      : fallbackKey;
    const rateLimitResult = await checkRateLimit(rateLimitKey, rateLimitConfig);
    if (!rateLimitResult.allowed) {
      const retryAfter = Math.ceil((rateLimitResult.retryAfterMs ?? 1000) / 1000);
      logger.warn('rate_limit_exceeded', {
        requestId,
        userId: tenantCtx.userId,
        clubId: tenantCtx.clubId,
        ip,
        routeKey: options?.routeKey ?? null,
        limit: rateLimitConfig.maxRequests,
        windowMs: rateLimitConfig.windowMs,
      });
      return NextResponse.json(
        { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } },
        { status: 429, headers: { 'Retry-After': String(retryAfter), 'x-request-id': requestId } },
      );
    }

    if (options?.requiredPermission) {
      if (!hasPermission(tenantCtx.orgRole, options.requiredPermission)) {
        return errorResponse(
          'FORBIDDEN',
          'You do not have permission to perform this action',
          403,
        );
      }
    }

    const auditFn = async (params: AuditParams): Promise<void> => {
      try {
        await createAuditEntry({
          clubId: tenantCtx.clubId,
          actorMemberId: tenantCtx.memberId,
          action: params.action,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          changes: params.changes,
          ipAddress: ip,
          userAgent,
        });
      } catch (err) {
        logger.error('audit_log_failed', {
          requestId,
          clubId: tenantCtx.clubId,
          userId: tenantCtx.userId,
          action: params.action,
          resourceType: params.resourceType,
          resourceId: params.resourceId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    };

    const ctx: AuthenticatedContext = {
      ...tenantCtx,
      requestId,
      audit: auditFn,
    };

    return await handler(ctx);
  } catch (error) {
    if (error instanceof TenantError) {
      const status = error.code === 'UNAUTHORIZED' ? 401 : 400;
      return errorResponse(error.code, error.message, status);
    }

    if (error instanceof PermissionError) {
      return errorResponse('FORBIDDEN', error.message, 403);
    }

    if (error instanceof ValidationError) {
      return errorResponse('VALIDATION_ERROR', error.message, 400, error.details);
    }

    if (error instanceof SyntaxError) {
      return errorResponse('INVALID_JSON', 'Request body contains invalid JSON', 400);
    }

    const headerStore = await headers().catch(() => null);
    const fallbackRequestId = headerStore?.get('x-request-id') ?? 'unknown';

    logger.error('unhandled_api_error', {
      requestId: fallbackRequestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return errorResponse(
      'INTERNAL_ERROR',
      'Something went wrong. Please try again.',
      500,
    );
  }
}
