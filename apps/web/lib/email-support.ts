import 'server-only';

import { after } from 'next/server';
import { isEmailSuppressed } from '@equestrian/db/queries';
import { logger } from './logger';

const RESEND_BASE_URL = process.env.RESEND_BASE_URL ?? 'https://api.resend.com';
const RESEND_FETCH_TIMEOUT_MS = 15_000;

interface SendArgs {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

/**
 * Lightweight plain-text sender that bypasses the per-club notification
 * preferences check in lib/email.ts. Used for operational mail with no club
 * context: support form replies, privacy intake confirmations, account-
 * deletion notices. Fire-and-forget — never throws.
 */
async function postOperationalEmail(args: SendArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('operational_email_skipped_no_key', { to: args.to, subject: args.subject });
    return;
  }
  // Audit pass-7 integration LOW (2026-05-25): match the audit D-2 fix
  // on `lib/email.ts` — refuse to fall back to `onboarding@resend.dev`
  // in production. A privacy-intake or support reply going from the
  // Resend sandbox sender in prod confuses the recipient (they don't
  // recognise the from-address as Cavaliq) and burns Resend's shared
  // sandbox reputation. Triggers if EMAIL_FROM is somehow unset during
  // a partial rotation; bail to a structured error log so on-call
  // sees the misconfiguration immediately.
  const envFrom = process.env.EMAIL_FROM;
  if (!envFrom && process.env.NODE_ENV === 'production') {
    logger.error('operational_email_from_unset_in_prod', {
      to: args.to,
      subject: args.subject,
      note: 'EMAIL_FROM is unset; refusing to send from sandbox sender. Operator-actionable.',
    });
    return;
  }
  const from = envFrom ?? 'Cavaliq <onboarding@resend.dev>';

  // Audit pass-7 followup ⑤ (2026-05-25): suppression-list check —
  // mirrors `sendEmail`. Operational mail (privacy intake replies,
  // account-deletion notices, support replies) still hits Resend's
  // sender-reputation pool, so a bounced operational address is just
  // as harmful as a bounced rider address.
  if (await isEmailSuppressed(args.to)) {
    logger.warn('operational_email_skipped_by_suppression', {
      to: args.to,
      subject: args.subject,
    });
    return;
  }

  try {
    const response = await fetch(`${RESEND_BASE_URL}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        text: args.text,
        ...(args.replyTo ? { reply_to: args.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(RESEND_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      logger.error('operational_email_failed', {
        to: args.to,
        subject: args.subject,
        status: response.status,
        body: raw.slice(0, 400),
      });
      return;
    }
    logger.info('operational_email_sent', { to: args.to, subject: args.subject });
  } catch (err) {
    logger.error('operational_email_error', {
      to: args.to,
      subject: args.subject,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}

/**
 * Schedule an operational email to send after the current response is
 * flushed. Matches the after()-based pattern in lib/email.ts so the Worker
 * isolate doesn't terminate before the email goes out.
 */
export function sendOperationalEmailAsync(args: SendArgs): void {
  const task = () =>
    postOperationalEmail(args).catch((err) => {
      logger.error('operational_email_unhandled', {
        to: args.to,
        subject: args.subject,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  try {
    after(task);
  } catch (err) {
    logger.warn('operational_email_after_unavailable_falling_back_to_void', {
      to: args.to,
      subject: args.subject,
      error: err instanceof Error ? err.message : String(err),
    });
    void task();
  }
}
