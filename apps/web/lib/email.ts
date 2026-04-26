import { Resend } from 'resend';
import { render } from '@react-email/components';
import { after } from 'next/server';
import { rawDb } from '@equestrian/db';
import { clubs, type NotificationPreferences } from '@equestrian/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from './logger';
import type { ReactElement } from 'react';

// In production, refuse to send unless EMAIL_FROM is explicitly configured.
// The previous fallback to `onboarding@resend.dev` (Resend's sandbox sender)
// silently produced low-trust mail that Gmail flags as "via resend.dev" and
// drops into spam — see audit D-2. Dev keeps the fallback so local testing
// without secrets still works. The /emails/send route had this guard before
// but every transactional send path (booking confirmation, livery invoice,
// no-show alerts, owner approvals) bypassed it by going through this module
// directly.
const FALLBACK_FROM_ADDRESS = 'Cavaliq <onboarding@resend.dev>';

function resolveFromAddress(): string | null {
  const configured = process.env.EMAIL_FROM;
  if (configured && configured.trim().length > 0) {
    return configured;
  }
  if (process.env.NODE_ENV === 'production') {
    logger.error('email_from_unset_in_prod', {
      message: 'EMAIL_FROM is not set; refusing to send transactional mail from the resend.dev sandbox sender',
    });
    return null;
  }
  return FALLBACK_FROM_ADDRESS;
}

function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('email_not_configured', { message: 'RESEND_API_KEY not set — emails will be skipped' });
    return null;
  }
  return new Resend(apiKey);
}

interface SendEmailParams {
  to: string;
  subject: string;
  template: ReactElement;
}

/**
 * Sends an email using Resend + React Email template.
 * Fire-and-forget — never throws. Returns success/failure status.
 * If RESEND_API_KEY is not set, silently skips.
 */
export async function sendEmail(params: SendEmailParams): Promise<{ sent: boolean; id?: string; error?: string }> {
  const resend = getResendClient();
  if (!resend) {
    return { sent: false, error: 'Email not configured' };
  }

  const fromAddress = resolveFromAddress();
  if (!fromAddress) {
    // Already logged via `email_from_unset_in_prod` in resolveFromAddress.
    return { sent: false, error: 'EMAIL_FROM not configured in production' };
  }

  try {
    const html = await render(params.template);

    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: [params.to],
      subject: params.subject,
      html,
    });

    if (error) {
      logger.error('email_send_failed', {
        to: params.to,
        subject: params.subject,
        error: error.message,
      });
      return { sent: false, error: error.message };
    }

    logger.info('email_sent', {
      to: params.to,
      subject: params.subject,
      id: data?.id,
    });

    return { sent: true, id: data?.id };
  } catch (err) {
    logger.error('email_send_error', {
      to: params.to,
      subject: params.subject,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    return { sent: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Retries `send` up to `maxAttempts` times with bounded backoff. Stops on the
 * first `{ sent: true }`. Used by the fire-and-forget paths so a Resend blip
 * during the post-response window doesn't permanently drop transactional
 * email (booking confirmations, livery invoices). Total wallclock is capped
 * at ~2.2s so we stay inside Cloudflare's `after()` budget on Workers.
 */
const RETRY_BACKOFFS_MS = [500, 1500] as const;

async function sendWithRetry(
  send: () => Promise<{ sent: boolean; error?: string }>,
  context: { to: string; subject: string; trigger?: NotificationTrigger; clubId?: string },
): Promise<void> {
  const maxAttempts = RETRY_BACKOFFS_MS.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await send();
    if (result.sent) return;
    if (attempt < maxAttempts) {
      // sendEmail already logged this attempt at `email_send_failed`; the
      // retry log here gives the operator a single grep-friendly event to
      // see how many retries it took without re-walking the failed-send
      // events. Jitter so concurrent failures don't all retry in lockstep.
      const base = RETRY_BACKOFFS_MS[attempt - 1]!;
      const delay = base + Math.floor(Math.random() * 250);
      logger.warn('email_send_retry_scheduled', {
        ...context,
        attempt,
        nextDelayMs: delay,
        error: result.error,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    } else {
      // Final exhaustion — escalate. This is the page-worthy event.
      logger.error('email_send_exhausted', {
        ...context,
        attempts: maxAttempts,
        error: result.error,
      });
    }
  }
}

/**
 * Sends an email after the response is flushed. Uses Next.js `after()` so
 * the task completes even on Cloudflare Workers, which otherwise freezes
 * the isolate after the response returns and kills any unawaited promises.
 *
 * Retries transient failures with bounded backoff (~2.2s max) so a Resend
 * blip doesn't drop the email permanently. Permanent failures (invalid
 * recipient, template render error) exhaust retries and log
 * `email_send_exhausted` at error level for paging.
 *
 * Safe to call from any request handler; falls back to bare fire-and-forget
 * if called outside a request context (e.g. from a script).
 */
export function sendEmailAsync(params: SendEmailParams): void {
  const task = () =>
    sendWithRetry(() => sendEmail(params), {
      to: params.to,
      subject: params.subject,
    }).catch((err) => {
      // sendWithRetry only awaits sendEmail, which catches everything
      // internally — but a bug in the retry helper itself (e.g., a future
      // regression where logger.error throws) shouldn't escape as an
      // unhandled rejection. Belt-and-braces guard.
      logger.error('email_send_unhandled', {
        to: params.to,
        subject: params.subject,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  try {
    after(task);
  } catch {
    void task();
  }
}

// ─── Trigger-gated sends (respect club notification_preferences) ──────

export type NotificationTrigger = keyof NotificationPreferences;

/**
 * Returns true if the given notification trigger is enabled (via email) for
 * the club. Missing preferences default to `true` so clubs that haven't
 * touched Settings → Notifications still get the transactional emails.
 *
 * Uses `rawDb` on purpose — this is called from many places, often outside an
 * active tenant context. The clubs row is exempt from RLS.
 */
export async function isNotificationEnabled(
  clubId: string,
  trigger: NotificationTrigger,
): Promise<boolean> {
  try {
    const rows = await rawDb
      .select({ prefs: clubs.notificationPreferences })
      .from(clubs)
      .where(eq(clubs.id, clubId))
      .limit(1);
    const prefs = rows[0]?.prefs as NotificationPreferences | null | undefined;
    if (!prefs) return true;
    const flag = prefs[trigger];
    if (!flag) return true;
    return flag.email !== false;
  } catch (err) {
    // Failing open — we don't want a DB blip to suppress customer receipts.
    logger.warn('notification_preference_lookup_failed', {
      clubId,
      trigger,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return true;
  }
}

interface TriggeredEmailParams extends SendEmailParams {
  clubId: string;
  trigger: NotificationTrigger;
}

/**
 * Awaited send that first checks the club's notification_preferences.
 * If the trigger's `email` flag is `false`, the send is skipped silently and
 * a log line is emitted so the audit trail shows it was intentional.
 *
 * Retries transient failures (~2.2s wallclock) so a single Resend blip
 * doesn't permanently drop a transactional email — important because callers
 * are typically inside an `after()` block where the only failure handler is
 * a `logger.error` with no retry of its own. Permanent failures still
 * exhaust retries and emit `email_send_exhausted` at error level for paging.
 *
 * Does NOT call `after()` — meant to be called from inside an existing
 * `after(async () => ...)` block in the route handler. Nesting `after()`
 * calls inside an `after()` callback throws on Next.js 15, which silently
 * breaks the whole send on Workers (the fallback fire-and-forget is then
 * killed by isolate termination).
 */
export async function sendTriggeredEmail(params: TriggeredEmailParams): Promise<void> {
  const { clubId, trigger, ...emailParams } = params;
  const enabled = await isNotificationEnabled(clubId, trigger);
  if (!enabled) {
    logger.info('email_skipped_by_preference', {
      clubId,
      trigger,
      to: emailParams.to,
      subject: emailParams.subject,
    });
    return;
  }
  await sendWithRetry(() => sendEmail(emailParams), {
    to: emailParams.to,
    subject: emailParams.subject,
    clubId,
    trigger,
  });
}

/**
 * Fire-and-forget variant for direct use outside an existing `after()`
 * block. Wraps `sendTriggeredEmail` in its own `after()` so the task
 * survives response flush on Cloudflare Workers, and inherits the
 * retry behaviour from `sendTriggeredEmail`. Falls back to a bare promise
 * when called outside a request context.
 */
export function sendTriggeredEmailAsync(params: TriggeredEmailParams): void {
  const task = () =>
    sendTriggeredEmail(params).catch((err) => {
      // sendTriggeredEmail uses sendWithRetry, which uses sendEmail (which
      // catches everything internally). The .catch here guards against a
      // future regression where the helper itself throws — without it,
      // an unhandled rejection would bypass our log/alert pipeline.
      logger.error('email_send_unhandled', {
        clubId: params.clubId,
        trigger: params.trigger,
        to: params.to,
        subject: params.subject,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  try {
    after(task);
  } catch {
    void task();
  }
}
