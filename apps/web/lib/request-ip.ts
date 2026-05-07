/**
 * Audit r5 F-46 (2026-05-07): the same 5-line client-IP resolver was
 * duplicated 4× across `requireCronSecret` (in `lib/api-utils.ts`),
 * the n-genius webhook, the ziina-platform webhook, and the public
 * `/api/v1/health` route. A future header source (e.g. Cloudflare's
 * `true-client-ip`) would have to be added in four places, and the
 * existing copies have already drifted in their default-fallback string
 * historically. Single helper, single source of truth.
 *
 * Order matters: Cloudflare's own `cf-connecting-ip` is authoritative
 * when the worker runs behind Cloudflare (which is always, in our
 * deployment). `x-forwarded-for` falls back for non-CF transit;
 * `x-real-ip` for unknown reverse proxies. The literal `'unknown'`
 * is the agreed-upon sentinel — `lib/queries/audit-log.ts:sanitizeIp`
 * specifically tests for it before logging an IP.
 */
export function getClientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}
