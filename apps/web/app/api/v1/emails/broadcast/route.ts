import { after, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAudienceById, resolveAudienceMembers } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseRequiredBody } from '@/lib/api-utils';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendPlainTextEmailWithRetry } from '@/lib/email';
import { logger } from '@/lib/logger';

/**
 * Send a plain-text email to every active rider in a saved audience.
 * Audit P0-B (2026-05-26) — Audiences were previously decorative; the
 * Compose form could only target a single recipient. This endpoint
 * resolves an audience to its rider list and fans out plain-text sends.
 *
 * Constraints (kept tight for MVP):
 *   - 50 recipients max per broadcast — matches the audience-list
 *     `pageSize` cap and bounds the operational cost.
 *   - 5 broadcasts per hour, BOTH per user (`withAuth`) and per club
 *     (explicit inline `checkRateLimit` keyed by `ctx.clubId`). The
 *     per-user route limit is insufficient on its own — without the
 *     club key, two staff accounts could each fire 5/hr (10/hr/club).
 *   - HTML disallowed — same plain-text-only rule as single-send.
 *   - Per-recipient rate-limit is NOT enforced. Each broadcast contacts
 *     each recipient exactly once; the broadcast-level caps are the
 *     spam-protection layer at this level.
 *
 * Async send path: the actual fan-out runs inside `after()` so the
 * response returns immediately (202). Synchronous sends would race the
 * client's 15s fetchJson timeout — a timeout there leaves earlier
 * chunks delivered and lets the operator retry, duplicating sends.
 * Async makes that race impossible. The trade is that the UI gets
 * `{queued: N}` instead of per-recipient counts; the operator sees
 * outcomes in the structured logger event `email_broadcast_complete`.
 *
 * KNOWN LIMITATION (codex P1, 2026-05-26): `after()` is bounded by the
 * Cloudflare Worker lifetime. Under sustained Resend 429s, retries can
 * push a 50-recipient broadcast past the platform's post-response
 * budget, dropping late recipients silently while the daily cap was
 * already reserved. A durable queue (Cloudflare Queues / a broadcasts
 * table + cron processor) is the correct fix and is queued as a P1
 * follow-up. For MVP the risk is low: typical Resend latency is
 * 200ms–2s, the retry path only kicks in on 429s, and the recipient
 * cap is 50.
 *
 * Suppression: `sendPlainTextEmailWithRetry` ultimately calls
 * `sendEmail` which checks `isEmailSuppressed` before posting to
 * Resend. Suppressed addresses count against `suppressed` in the
 * structured log so the operator sees attrition.
 */
const broadcastSchema = z
  .object({
    audienceId: z.string().uuid('Invalid audience id'),
    subject: z.string().min(1, 'Subject is required').max(500),
    body: z.string().min(1, 'Body is required').max(20_000),
  })
  .strict();

const MAX_RECIPIENTS_PER_BROADCAST = 50;
const CONCURRENCY = 5;

interface QueuedBroadcastResponse {
  queued: number;
  noEmail: number;
  /** Recipients dropped because the per-club 500/day cap had no headroom. */
  capSkipped: number;
  /** Recipients dropped because their email collided with an earlier row. */
  duplicateSkipped: number;
  total: number;
  audienceId: string;
  audienceName: string;
}

function isEmailServiceConfigured(): boolean {
  // Preflight before queuing: without these, every send in the async
  // path returns `{ sent: false, error: 'Email not configured' }` and
  // the operator sees a successful 202 followed by silent failure
  // (the daily cap slots were already reserved). The single-send
  // route surfaces this as 503 at call time — we mirror that here
  // BEFORE the async fan-out. codex P2 (2026-05-26).
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const isProd = process.env.NODE_ENV === 'production';
  const emailFrom = process.env.EMAIL_FROM;
  if (isProd && (!emailFrom || emailFrom.trim().length === 0)) return false;
  return true;
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const data = await parseRequiredBody(request, broadcastSchema);

      if (!isEmailServiceConfigured()) {
        return errorResponse('EMAIL_NOT_CONFIGURED', 'Email service is not configured.', 503);
      }

      // Club-keyed cap. `withAuth`'s route-level rateLimit option keys
      // by `${userId}:${routeKey}` — without this inline check, every
      // staff account in the same club would get its own 5/hr budget.
      // failClosed so an Upstash blip can't lift the limit on a spam-
      // relay surface (mirrors `/api/v1/emails/send`'s per-club caps).
      const clubLimit = await checkRateLimit(`email:broadcast:club:${ctx.clubId}`, {
        maxRequests: 5,
        windowMs: 60 * 60_000,
        failClosed: true,
      });
      if (!clubLimit.allowed) {
        const retryAfterSec = Math.ceil((clubLimit.retryAfterMs ?? 1000) / 1000);
        const retryAfterMin = Math.max(1, Math.ceil(retryAfterSec / 60));
        return errorResponse(
          'CLUB_BROADCAST_RATE_LIMITED',
          `This club has reached the 5-broadcast/hour cap. Try again in ~${retryAfterMin} min.`,
          429,
        );
      }

      const audience = await getAudienceById(ctx.clubId, data.audienceId);
      if (!audience) {
        return errorResponse('AUDIENCE_NOT_FOUND', 'Audience not found', 404);
      }

      // Pull up to 2× cap + 1 so we can detect oversized audiences
      // AFTER applying the no-email + dedupe filters. If the resolved
      // row count hits this hard ceiling, we can't tell whether the
      // unique sendable count is ≤cap (false rejection) or far over
      // (correct rejection), so we refuse rather than partially send —
      // codex P2 (2026-05-26). The operator must split the audience.
      const RESOLVE_HARD_CEILING = MAX_RECIPIENTS_PER_BROADCAST * 2 + 1;
      const matched = await resolveAudienceMembers(ctx.clubId, audience.filters ?? {}, {
        limit: RESOLVE_HARD_CEILING,
      });

      if (matched.length === 0) {
        return errorResponse(
          'AUDIENCE_EMPTY',
          'No active riders match this audience right now.',
          422,
        );
      }

      // Cannot safely dedupe past this — would risk a partial broadcast
      // that the UI / aggregate counts wouldn't reflect.
      if (matched.length >= RESOLVE_HARD_CEILING) {
        return errorResponse(
          'AUDIENCE_TOO_LARGE',
          `This audience resolves to ${RESOLVE_HARD_CEILING - 1}+ riders, which exceeds the broadcast resolution ceiling. Please split the audience into smaller groups (each capped at ${MAX_RECIPIENTS_PER_BROADCAST} unique recipients).`,
          422,
        );
      }

      // `clubMembers.email` is nullable — split into sendable rows + a
      // count of no-email skips so the operator sees attrition.
      const withEmail = matched.filter(
        (r): r is typeof r & { email: string } => typeof r.email === 'string' && r.email.length > 0,
      );
      const noEmailCount = matched.length - withEmail.length;

      // Dedupe by normalized email. `club_members.email` is NOT unique
      // — a parent and child rider can share a mailbox, or two member
      // rows can hold the same address for distinct riders. Without
      // dedupe, those mailboxes would receive the same broadcast
      // multiple times AND would consume the daily cap multiple times.
      const seen = new Set<string>();
      const recipients = withEmail.filter((r) => {
        const norm = r.email.toLowerCase();
        if (seen.has(norm)) return false;
        seen.add(norm);
        return true;
      });
      const duplicateSkipped = withEmail.length - recipients.length;

      if (recipients.length === 0) {
        return errorResponse(
          'NO_RECIPIENT_EMAILS',
          'No riders in this audience have an email address on file.',
          422,
        );
      }

      // Apply the recipient cap AFTER filtering so an audience whose
      // matched row count exceeds the cap but whose unique sendable
      // count stays under doesn't get blocked. Codex P2 (2026-05-26)
      // — the previous order rejected legitimate cases where a club
      // had many riders sharing email addresses.
      if (recipients.length > MAX_RECIPIENTS_PER_BROADCAST) {
        return errorResponse(
          'AUDIENCE_TOO_LARGE',
          `Broadcasts are capped at ${MAX_RECIPIENTS_PER_BROADCAST} unique recipients per send. This audience resolves to more — please narrow the filters or split the audience.`,
          422,
        );
      }

      // Reserve the broadcast's share of the per-club daily cap that
      // `/api/v1/emails/send` enforces (500/day). Without this the
      // broadcast endpoint would sidestep the safety net and a
      // compromised admin could push ~6,000 emails/day via 5
      // broadcasts/hour × 50 recipients × 24h. We pre-increment the
      // daily-cap counter once per recipient up-front. Recipients that
      // don't fit under the remaining cap are skipped in the fan-out
      // (counted in `capSkipped`).
      //
      // Promise.all parallelizes the Upstash round-trips; each
      // `checkRateLimit` call is atomic (Upstash sliding-window Lua),
      // so concurrent increments are safe.
      const DAILY_CAP_KEY = `email:club_day:${ctx.clubId}`;
      const DAILY_CAP_CONFIG = {
        maxRequests: 500,
        windowMs: 24 * 60 * 60_000,
        failClosed: true,
      } as const;
      const capChecks = await Promise.all(
        recipients.map(() => checkRateLimit(DAILY_CAP_KEY, DAILY_CAP_CONFIG)),
      );
      const allowedRecipients = recipients.filter((_, i) => capChecks[i]?.allowed === true);
      const capSkipped = recipients.length - allowedRecipients.length;

      if (allowedRecipients.length === 0) {
        return errorResponse(
          'CLUB_DAILY_CAP',
          'This club has reached the 500-email daily cap; resumes tomorrow.',
          429,
        );
      }

      // Snapshot the recipient list and metadata for the async closure.
      // ctx is request-scoped; the async sender must NOT close over
      // ctx.audit (its AsyncLocalStorage context won't survive). Audit
      // the broadcast START synchronously so the operator can see who
      // started what; per-recipient + final outcome are logged via
      // `logger` from the async path.
      const audienceId = audience.id;
      const audienceName = audience.name;
      const subject = data.subject;
      const text = data.body;
      const clubId = ctx.clubId;

      void ctx.audit({
        action: 'email.broadcast.start',
        resourceType: 'audience',
        resourceId: audienceId,
        changes: {
          subject: { from: null, to: subject },
          recipientCount: { from: null, to: allowedRecipients.length },
          noEmail: { from: null, to: noEmailCount },
          duplicateSkipped: { from: null, to: duplicateSkipped },
          capSkipped: { from: null, to: capSkipped },
        },
      });

      // Fire-and-forget fan-out. Next.js `after()` keeps the Worker
      // isolate alive after the response flushes — without it, the
      // unawaited promise would be killed when the response returns.
      after(async () => {
        let sent = 0;
        let suppressed = 0;
        let failed = 0;

        // Use the retry helper now that wall-clock is no longer
        // constrained by the response cycle. Transient Resend 429s and
        // network blips deserve the same bounded retry path the
        // single-send route already trusts.
        for (let i = 0; i < allowedRecipients.length; i += CONCURRENCY) {
          const chunk = allowedRecipients.slice(i, i + CONCURRENCY);
          const results = await Promise.allSettled(
            chunk.map((r) => sendPlainTextEmailWithRetry({ to: r.email, subject, text })),
          );

          for (let j = 0; j < results.length; j += 1) {
            const settled = results[j];
            const recipient = chunk[j];
            if (!recipient) continue;
            if (settled?.status === 'fulfilled') {
              if (settled.value.sent) {
                sent += 1;
              } else if (
                typeof settled.value.error === 'string' &&
                settled.value.error.toLowerCase().includes('suppress')
              ) {
                suppressed += 1;
              } else {
                failed += 1;
                logger.warn('broadcast_send_failed', {
                  clubId,
                  audienceId,
                  to: recipient.email,
                  error: settled.value.error,
                });
              }
            } else {
              failed += 1;
              logger.error('broadcast_send_threw', {
                clubId,
                audienceId,
                to: recipient.email,
                error:
                  settled?.reason instanceof Error
                    ? settled.reason.message
                    : String(settled?.reason ?? 'unknown'),
              });
            }
          }
        }

        const logFn = sent === 0 && failed > 0 ? logger.error : logger.info;
        logFn('email_broadcast_complete', {
          clubId,
          audienceId,
          audienceName,
          sent,
          suppressed,
          failed,
          noEmail: noEmailCount,
          duplicateSkipped,
          capSkipped,
          total: matched.length,
        });
      });

      const response: QueuedBroadcastResponse = {
        queued: allowedRecipients.length,
        noEmail: noEmailCount,
        duplicateSkipped,
        capSkipped,
        total: matched.length,
        audienceId,
        audienceName,
      };
      return successResponse(response, 202);
    },
    {
      requiredPermission: 'emails:create',
      // Per-user cap at the route level. CLUB-wide cap is enforced
      // inline above with a `ctx.clubId`-keyed limiter — `withAuth`
      // rate-limits by user only.
      rateLimit: { maxRequests: 5, windowMs: 60 * 60_000, failClosed: true },
      routeKey: 'emails:broadcast',
    },
  );
}
