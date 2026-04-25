import { Resend } from 'resend';
import { render } from '@react-email/components';
import { after } from 'next/server';
import { rawDb } from '@equestrian/db';
import { clubs, type NotificationPreferences } from '@equestrian/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from './logger';
import type { ReactElement } from 'react';

const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'Cavaliq <onboarding@resend.dev>';

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

  try {
    const html = await render(params.template);

    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
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
 * Sends an email after the response is flushed. Uses Next.js `after()` so
 * the task completes even on Cloudflare Workers, which otherwise freezes
 * the isolate after the response returns and kills any unawaited promises.
 *
 * Safe to call from any request handler; falls back to bare fire-and-forget
 * if called outside a request context (e.g. from a script).
 */
export function sendEmailAsync(params: SendEmailParams): void {
  const task = () =>
    sendEmail(params).catch((err) => {
      // sendEmail catches everything internally and logs as
      // `email_send_failed` / `email_send_error`. The .catch here is a
      // belt-and-braces guard against a future regression where sendEmail
      // is changed to throw — without this, the error would surface as
      // a raw unhandled rejection in Sentry, bypassing alert routing.
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
  await sendEmail(emailParams);
}

/**
 * Fire-and-forget variant for direct use outside an existing `after()`
 * block. Wraps the send in its own `after()` so the task survives response
 * flush on Cloudflare Workers. Falls back to a bare promise when called
 * outside a request context.
 */
export function sendTriggeredEmailAsync(params: TriggeredEmailParams): void {
  const task = () => sendTriggeredEmail(params);
  try {
    after(task);
  } catch {
    void task();
  }
}
