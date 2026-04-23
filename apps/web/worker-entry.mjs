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
    const url = new URL('/api/cron/livery-billing', 'https://internal.worker/');
    const request = new Request(url.toString(), {
      method: 'POST',
      headers: {
        'x-cron-secret': env.CRON_SECRET ?? '',
        'content-type': 'application/json',
        'user-agent': 'cavaliq-cron-scheduled',
      },
    });

    const task = worker
      .fetch(request, env, ctx)
      .then(async (res) => {
        // Read + discard the body so the response is drained before the
        // isolate shuts down — CF will log the status via observability.
        const body = await res.text().catch(() => '');
        if (!res.ok) {
          console.error('cron_scheduled_non_ok', {
            cron: event.cron,
            status: res.status,
            body: body.slice(0, 500),
          });
        } else {
          console.log('cron_scheduled_ok', {
            cron: event.cron,
            status: res.status,
          });
        }
      })
      .catch((err) => {
        console.error('cron_scheduled_failed', {
          cron: event.cron,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    ctx.waitUntil(task);
  },
};
