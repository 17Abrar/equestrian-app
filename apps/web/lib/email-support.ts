import 'server-only';

import { after } from 'next/server';
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
  const from = process.env.EMAIL_FROM ?? 'Cavaliq <onboarding@resend.dev>';

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
