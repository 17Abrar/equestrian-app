import { Resend } from 'resend';
import { render } from '@react-email/components';
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
 * Sends an email in the background — does not block the caller.
 * Use this in API routes so the response isn't delayed by email delivery.
 */
export function sendEmailAsync(params: SendEmailParams): void {
  sendEmail(params).catch(() => {
    // Already logged inside sendEmail — swallow here
  });
}
