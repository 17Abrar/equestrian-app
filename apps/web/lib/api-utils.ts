import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { z, ZodError, type ZodTypeAny } from 'zod';
import { type UserRole } from '@equestrian/shared/types';
import { paginationSchema } from '@equestrian/shared/schemas';
import { getTenantContext, TenantError, type ActiveMembership } from './tenant';
import { hasPermission, PermissionError } from './permissions';
import { logger } from './logger';
import { checkRateLimit, type RateLimitConfig } from './rate-limit';
import { getClientIp } from './request-ip';
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

export function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ success: false, error: { code, message, details } }, { status });
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
 * Audit r5 F-60 (2026-05-07): the same pagination-parse block was
 * duplicated verbatim across 9 list routes. Extracted here so a
 * future schema tweak (e.g. tightening `pageSize` cap, accepting a
 * `cursor`) lands once. Use as the first line of every paginated GET:
 *
 *   const { page, pageSize } = parsePagination(request);
 */
export function parsePagination(request: NextRequest): {
  page: number;
  pageSize: number;
} {
  return validateInput(paginationSchema, {
    page: request.nextUrl.searchParams.get('page') ?? undefined,
    pageSize: request.nextUrl.searchParams.get('pageSize') ?? undefined,
  });
}

/**
 * Audit r5 F-60 (2026-05-07): companion to `parsePagination`. Identical
 * payload shape to the existing `paginatedResponse`-with-object call,
 * just argument-flattened so the call site reads like a tuple
 * (`paginatedListResponse(items, page, pageSize, total)`) instead of
 * the wrap-in-object form. Existing call sites that want to keep the
 * object form continue to use `paginatedResponse`.
 */
export function paginatedListResponse<T>(
  items: T[],
  page: number,
  pageSize: number,
  total: number,
) {
  return paginatedResponse(items, { page, pageSize, total });
}

/**
 * Validates input against a Zod schema. Returns the parsed output type,
 * which includes defaults applied by `.default()` modifiers.
 * Throws ValidationError with flattened details on failure.
 */
export function validateInput<S extends ZodTypeAny>(schema: S, data: unknown): S['_output'] {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(result.error);
  }
  return result.data;
}

// Audit F-21 (2026-05-06 comprehensive). Cron handlers verify a shared
// secret in the `x-cron-secret` header. Extracting the check here means
// a new cron route added to the public-route allowlist (apps/web/middleware
// .ts) cannot reach business logic without explicitly calling this guard
// — a single missed `requireCronSecret` line shows up immediately in
// `gh pr` diff review rather than as a silently public mutator.
//
// Returns `null` when authorized (caller continues). Returns a
// NextResponse to be returned directly when not authorized.
export async function requireCronSecret(
  request: Request,
  eventName: string,
): Promise<NextResponse | null> {
  const { timingSafeEqual } = await import('node:crypto');
  const headerSecret = request.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    logger.error(`${eventName}_secret_not_configured`);
    return errorResponse('NOT_CONFIGURED', 'CRON_SECRET not set', 503);
  }

  // Audit F-31 (2026-05-07 r4 Xi-bis): straightforward header → length
  // gate → timingSafeEqual. The previous padded-buffer dance compared
  // against zeros on length mismatch (the timingSafeEqual result was
  // dead code), making the comment misleading and inviting a future
  // contributor to "optimise away" the `sameLength &&` guard. The
  // length-side-channel trade-off is accepted: the secret length is
  // fixed at deploy time, so leaking it via early return discloses
  // no useful attacker information. Identical-length compares stay
  // constant-time via timingSafeEqual.
  function logBadSecret(): void {
    // Audit F-14 (2026-05-07 r4): no `providedLength` in the log line —
    // logging the attacker-supplied length on every wrong attempt is
    // information disclosure to operators-with-log-read-access (helps
    // calibrate forgery attempts). Match Ziina's webhook signature
    // mismatch logging pattern.
    // Audit r5 F-46 (2026-05-07): IP resolver moved to `lib/request-ip.ts`.
    logger.warn(`${eventName}_bad_secret`, {
      headerPresent: headerSecret !== null,
      ip: getClientIp(request),
    });
  }

  if (headerSecret === null) {
    logBadSecret();
    return errorResponse('UNAUTHORIZED', 'Invalid cron secret', 401);
  }

  const provided = Buffer.from(headerSecret, 'utf8');
  const target = Buffer.from(expected, 'utf8');

  // Audit F-38 (2026-05-08 r6): when a header IS present but doesn't
  // match, escalate to error level so secret-rotation drift becomes
  // visible. Distinguishes the "operator forgot to set secret" case
  // (already error-logged at line 151 above) from "wrangler updated
  // CRON_SECRET but the running isolate still binds the old value"
  // — operators-on-call need both signals. The header-missing case
  // stays at warn (most likely just a bad probe / misconfigured
  // monitor, not secret drift).
  if (provided.length !== target.length || !timingSafeEqual(provided, target)) {
    logger.error(`${eventName}_secret_mismatch`, {
      headerPresent: true,
      ip: getClientIp(request),
    });
    return errorResponse('UNAUTHORIZED', 'Invalid cron secret', 401);
  }

  return null;
}

const uuidParamSchema = z.string().uuid();

/**
 * Validates a URL path param expected to be a UUID. Audit F-10
 * (2026-05-06): without this guard, a malformed id (`/bookings/foo`)
 * threads straight into Drizzle, hits Postgres `22P02 invalid input
 * syntax for type uuid`, and the route's catch-all surfaces a 500 —
 * wrong status code AND a wasted DB round-trip.
 *
 * Use as the first line of every dynamic-segment handler:
 *   const bookingId = validateUuidParam('bookingId', (await params).bookingId);
 */
export function validateUuidParam(name: string, value: string): string {
  const r = uuidParamSchema.safeParse(value);
  if (!r.success) {
    const issues = new ZodError([
      { code: 'custom', path: [name], message: 'Invalid id (expected UUID)' },
    ]);
    throw new ValidationError(issues);
  }
  return r.data;
}

/**
 * Default request-body cap (1 MB). Any authenticated JSON route should
 * comfortably fit — Zod schemas have field-level `.max()` caps under
 * 5KB anywhere in the codebase. The Cloudflare Worker's outer 100 MB
 * limit is a fallback; this is the per-route guard so a 50 MB hostile
 * body doesn't burn JSON.parse + isolate memory before validation
 * sees it. See audit G-32.
 */
export const MAX_REQUEST_BODY_BYTES = 1 * 1024 * 1024;

export class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body exceeds the maximum allowed size');
    this.name = 'PayloadTooLargeError';
  }
}

async function readBodyTextWithCap(request: Request, maxBytes: number): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new PayloadTooLargeError();
    }
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new PayloadTooLargeError();
  }
  return text;
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
  const text = await readBodyTextWithCap(request, MAX_REQUEST_BODY_BYTES);
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

/**
 * Required-body sibling of parseOptionalBody — validates against the
 * schema (no empty-body fallback). Use for routes that mandate a body
 * payload. Throws PayloadTooLargeError when the request body exceeds
 * MAX_REQUEST_BODY_BYTES; withAuth catches it and returns 413.
 *
 * Audit F-63 (2026-05-07 r5): a `no-restricted-syntax` ESLint rule in
 * `tooling/eslint/nextjs.js` blocks new `request.json()` calls inside
 * `apps/web/app/api/v1/**` so future routes land in this helper. ~50
 * legacy routes still call `request.json()` directly; the migration
 * is mechanical (replace `const body = await request.json(); const
 * data = validateInput(schema, body);` with `const data = await
 * parseRequiredBody(request, schema);`) but high-blast-radius for one
 * PR. Migrate as you touch each route.
 */
export async function parseRequiredBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<S['_output']> {
  const text = await readBodyTextWithCap(request, MAX_REQUEST_BODY_BYTES);
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
  // Hoisted so the catch handler can re-use it without re-reading headers
  // (audit AI-27). Default to 'unknown' so the catch path is robust to
  // a throw that lands before headers() resolves.
  let requestId = 'unknown';
  // Audit F-5 (2026-05-07 r4): hoist clubId / userId so the
  // `unhandled_api_error` catch arm can tag Sentry with tenant context.
  // The Sentry forwarder in `lib/logger.ts` keys `club_id` + `setUser`
  // off these fields — without them, every unhandled 500 lands in
  // Sentry untagged and an operator triaging "which club is hitting
  // the wall?" has no signal. The `TenantError` arm legitimately can't
  // have these (the throw originates inside `getTenantContext` itself),
  // but every other arm SHOULD.
  let outerClubId: string | undefined;
  let outerUserId: string | undefined;
  try {
    const headerStore = await headers();
    requestId = headerStore.get('x-request-id') ?? crypto.randomUUID();
    const ip =
      headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      headerStore.get('x-real-ip') ??
      'unknown';
    const userAgent = headerStore.get('user-agent') ?? 'unknown';

    const tenantCtx = await getTenantContext();
    outerClubId = tenantCtx.clubId;
    outerUserId = tenantCtx.userId;

    // Rate limiting (per user, default 60 req/min). When the caller doesn't
    // pass a routeKey, fall back to the request pathname (set on the
    // headers by middleware) so each route gets its own bucket — without
    // this, all endpoints share a single 60/min budget per user and a
    // 3-tab admin polling 5 endpoints starves itself with spurious 429s.
    // Audit G-21.
    //
    // Audit auth-8: collapse UUID-shaped path segments to `:id` so a user
    // hitting the same logical route on N different resource ids doesn't
    // create N distinct rate-limit buckets. `/horses/abc-...-/exercise`
    // and `/horses/def-...-/exercise` share a single bucket. routeKey
    // (when set) takes precedence — that's the canonical per-route bucket.
    const rateLimitConfig = options?.rateLimit ?? { maxRequests: 60, windowMs: 60_000 };
    const pathname = headerStore.get('x-pathname') ?? '';
    const normalizedPath = pathname.replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      ':id',
    );
    const fallbackKey = normalizedPath ? `${tenantCtx.userId}:${normalizedPath}` : tenantCtx.userId;
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
        {
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
        },
        { status: 429, headers: { 'Retry-After': String(retryAfter), 'x-request-id': requestId } },
      );
    }

    if (options?.requiredPermission) {
      if (!hasPermission(tenantCtx.orgRole, options.requiredPermission)) {
        return errorResponse('FORBIDDEN', 'You do not have permission to perform this action', 403);
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
      // NO_MEMBERSHIP (audit auth-5) → 503 so the rider's UI can prompt
      // "your account is being set up — refresh in a moment". The error
      // is transient (Clerk webhook delivery race), not a hard 401/403.
      const status =
        error.code === 'UNAUTHORIZED' ? 401 : error.code === 'NO_MEMBERSHIP' ? 503 : 400;
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

    if (error instanceof PayloadTooLargeError) {
      return errorResponse('PAYLOAD_TOO_LARGE', error.message, 413);
    }

    // Reuse the requestId captured at the top of withAuth (audit AI-27).
    // The previous fallback re-read headers() inside the catch — both
    // unnecessary (the value is in scope) and fragile.
    //
    // Audit F-5 (2026-05-07 r4): include hoisted clubId / userId when
    // they were resolved before the throw. Sentry's logger forwarder
    // tags `club_id` + setUser from these keys, so without them every
    // unhandled 500 lands untagged.
    logger.error('unhandled_api_error', {
      requestId,
      clubId: outerClubId,
      userId: outerUserId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return errorResponse('INTERNAL_ERROR', 'Something went wrong. Please try again.', 500);
  }
}
