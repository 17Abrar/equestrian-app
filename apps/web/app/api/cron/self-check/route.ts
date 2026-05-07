import { type NextRequest } from 'next/server';
import { requireCronSecret } from '@/lib/api-utils';

/**
 * Audit F-43 (2026-05-07 r4): one-shot self-check fired at cold start by
 * `worker-entry.mjs` to verify Cloudflare's `env.CRON_SECRET` is
 * propagating into Next.js's `process.env.CRON_SECRET` binding. The
 * env-binding mismatch has bitten this stack before — `env.CRON_SECRET`
 * arrives at `scheduled()` while `process.env.CRON_SECRET` is undefined
 * inside the Next.js route, causing every cron tick to 503 silently.
 *
 * Returns:
 *   - 200 OK  → binding healthy (process.env.CRON_SECRET matches the
 *               header value the worker entry sent)
 *   - 503     → process.env.CRON_SECRET is missing entirely (binding
 *               broken)
 *   - 401     → header didn't match the env (possible secret rotation
 *               drift between wrangler and runtime)
 *
 * No side effects — the route does nothing beyond echoing the
 * `requireCronSecret` outcome. Safe to call on every cold start.
 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireCronSecret(request, 'cron_self_check');
  if (unauthorized) return unauthorized;
  return new Response('OK', { status: 200 });
}
