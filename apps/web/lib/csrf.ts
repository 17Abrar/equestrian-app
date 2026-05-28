import type { NextRequest } from 'next/server';

/**
 * Same-origin / CSRF guard for routes that mutate state without going
 * through `withAuth` (which itself relies on the tenant context). Used
 * by manual-auth state-changing endpoints:
 *
 *   - /api/v1/me/active-club (POST/DELETE) — sets/clears the active-club cookie
 *   - /api/v1/clubs/bootstrap (POST) — provisions `clubs` + `club_members`
 *
 * Returns true iff the request is from a known origin OR carries the
 * custom `x-cavaliq-csrf: 1` header that `fetchJson` sends. A naive
 * cross-site form POST can't satisfy either (custom header forces a
 * CORS preflight which the server refuses; Origin reflects the
 * attacker site).
 *
 * Audit F-6 (2026-05-06): require either a known Origin OR the custom
 * header — the previous fall-open on missing Origin trusted a broader
 * surface than the comment claimed (some legacy form posts and embedded
 * WebViews omit Origin entirely).
 */

// Read at module load so the cost amortizes across requests. Env vars
// don't change at runtime on Workers; if CORS_ALLOWED_ORIGINS is empty
// we still allow the request's own URL origin which covers localhost
// and preview domains.
const CSRF_ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
);

export function isSameOriginRequest(request: NextRequest): boolean {
  // Custom-header path: `fetchJson` sets this on every client call. A
  // cross-site request that tries to set it would trigger a CORS
  // preflight which the server refuses, so it can't reach this code
  // path with the header present.
  if (request.headers.get('x-cavaliq-csrf') === '1') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  if (origin === request.nextUrl.origin) return true;
  return CSRF_ALLOWED_ORIGINS.has(origin);
}
