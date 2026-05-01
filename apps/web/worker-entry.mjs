/* eslint-disable no-undef, no-console -- Cloudflare Worker entry: URL,
   Request, console are globals in the Worker runtime; logs are intentional
   and drain to Cloudflare's observability pipeline. */
// Wrapper around the OpenNext-generated Cloudflare Worker that adds a
// `scheduled()` export so Cloudflare Cron Triggers can fire our internal
// billing job. OpenNext 1.x doesn't expose a wrapper override in
// `open-next.config.ts`, so we re-export the generated module's surface here
// and tack on `scheduled()`.
//
// Build order:
//   1. `pnpm opennextjs-cloudflare build`  — generates `.open-next/worker.js`
//   2. `wrangler deploy` — uses this file (per wrangler.jsonc `main`)
//
// Cron wiring: when a cron trigger fires, we construct an internal POST
// request to `/api/cron/livery-billing` and hand it directly to the
// generated worker's own fetch handler. Keeps the traffic inside the
// isolate — no public round-trip — and gets the same auth middleware
// behavior as an external call.

import worker from './.open-next/worker.js';

// Re-export any Durable Object classes the generated worker exports so
// Cloudflare can still bind them. OpenNext currently exports these three;
// if they add more we'll see a "missing export" error at deploy and can
// mirror it.
export {
  DOQueueHandler,
  DOShardedTagCache,
  BucketCachePurge,
} from './.open-next/worker.js';

export default {
  fetch: worker.fetch,

  /**
   * Cloudflare Cron Trigger entrypoint. Schedule comes from
   * wrangler.jsonc → triggers.crons.
   *
   * Fires a POST to our own /api/cron/livery-billing handler. The route
   * checks `x-cron-secret` against the CRON_SECRET env secret and runs
   * invoice issuing + overdue reminders. `ctx.waitUntil` keeps the Worker
   * alive until the fetch resolves even though this handler already returned.
   */
  async scheduled(event, env, ctx) {
    // Audit L-9: refuse to send a cron tick when CRON_SECRET is missing
    // from the worker env. The route would 401 either way, but a loud
    // startup error makes the misconfig visible in tail logs immediately
    // instead of after the day's billing has been silently skipped.
    if (!env.CRON_SECRET) {
      console.error('cron_scheduled_skipped_missing_secret', {
        cron: event.cron,
      });
      return;
    }
    const url = new URL('/api/cron/livery-billing', 'https://internal.worker/');
    const request = new Request(url.toString(), {
      method: 'POST',
      headers: {
        'x-cron-secret': env.CRON_SECRET,
        'content-type': 'application/json',
        'user-agent': 'cavaliq-cron-scheduled',
      },
    });

    const task = worker
      .fetch(request, env, ctx)
      .then(async (res) => {
        // Drain the response body so the isolate doesn't hold the socket
        // open; we don't read its content — see audit G-27, body could
        // include `error.message` text we'd rather not echo.
        await res.text().catch(() => '');
        if (!res.ok) {
          // Most non-2xx paths from the cron route ALSO fire a
          // logger.error() inside the route (which goes to Sentry) — see
          // the route's top-level try/catch and per-step logger.error
          // calls. This console.error is the last-resort signal for
          // operators reading Cloudflare's tail when the route itself
          // failed to log; status code only, no body content (which
          // could include error.message with internal info — audit G-27).
          console.error('cron_scheduled_non_ok', {
            cron: event.cron,
            status: res.status,
          });
        } else {
          console.log('cron_scheduled_ok', {
            cron: event.cron,
            status: res.status,
          });
        }
      })
      .catch((err) => {
        // Fetch-level throw: the request never made it to the route, so
        // there's no Sentry-connected logger.error inside Next.js to
        // emit a tagged event. Best-effort signal via console.error so
        // it lands in Cloudflare's observability tail. Operators
        // monitoring `cron_scheduled_failed` need a separate Logpush
        // alert rule until @sentry/cloudflare is wired into this entry —
        // tracked by audit H-6. Worker-isolate fetch throws are rare
        // (binding misconfig, bundler issue) so the alerting gap is
        // narrow.
        console.error('cron_scheduled_failed', {
          cron: event.cron,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    ctx.waitUntil(task);
  },
};
