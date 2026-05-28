import { headers } from 'next/headers';
import { Webhook } from 'svix';
import {
  addEmailSuppression,
  claimWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
} from '@equestrian/db/queries';
import { logger } from '@/lib/logger';
import { readWebhookBody, WEBHOOK_BODY_CAPS } from '@/lib/payments/webhook-body';

/**
 * Resend webhook receiver. Pass-7 integration audit MED (2026-05-25).
 *
 * Without this, `email.bounced` / `email.complained` / `email.failed`
 * events were not ingested — recipients whose mailbox hard-bounced or
 * marked us as spam kept getting transactional sends until Resend's own
 * suppression list caught up, and we had zero internal visibility (no
 * `email_bounce` log, no Sentry, no DB row). For a multi-tenant SaaS
 * where one club's bad recipient list could cause Resend rate-limits
 * affecting every club, that's operationally meaningful.
 *
 * Phase 1 (this PR): ingest + log + dedup via webhook_events. Phase 2
 * (follow-up): introduce an `email_suppressions` table that
 * `sendEmail` checks before sending so bounced addresses are skipped
 * automatically.
 *
 * Auth: Resend uses Svix-based signing — same library as Clerk webhooks.
 * Verify headers (`svix-id`, `svix-timestamp`, `svix-signature`) against
 * `RESEND_WEBHOOK_SECRET` configured at https://resend.com/webhooks.
 *
 * Add to `apps/web/middleware.ts` `isPublicRoute` allowlist (cron secret
 * isn't used here — svix signature IS the auth).
 */

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[] | string;
    subject?: string;
    /** Present on email.bounced — includes bounce_type ('hard'/'soft'/'undetermined'). */
    bounce?: { message?: string; subType?: string };
    /** Present on email.complained — includes the recipient ISP code. */
    complaint?: { feedbackType?: string };
    /** Present on email.failed — short reason string. */
    failed?: { reason?: string };
  };
}

const ACTIONABLE_EVENT_TYPES = new Set([
  'email.bounced',
  'email.complained',
  'email.failed',
  'email.delivery_delayed',
]);

const NOOP_EVENT_TYPES = new Set([
  'email.sent',
  'email.delivered',
  'email.opened',
  'email.clicked',
  'email.scheduled',
]);

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();

  const body = await readWebhookBody(request, WEBHOOK_BODY_CAPS.resend, 'resend');
  if (body === null) {
    return new Response('Payload too large', { status: 413 });
  }

  const headersList = await headers();
  const svixId = headersList.get('svix-id');
  const svixTimestamp = headersList.get('svix-timestamp');
  const svixSignature = headersList.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    logger.warn('resend_webhook_missing_headers', { requestId });
    return new Response('Missing svix headers', { status: 400 });
  }

  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error('resend_webhook_no_secret', { requestId, svixId });
    // 401 not 503 — operator-actionable, not transient. Matches the
    // Clerk handler's posture (audit F-31).
    return new Response('Webhook secret not configured', { status: 401 });
  }

  let event: ResendEvent;
  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ResendEvent;
  } catch (error) {
    logger.error('resend_webhook_verification_failed', {
      requestId,
      svixId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return new Response('Invalid signature', { status: 400 });
  }

  // Dedup via webhook_events PRIMARY KEY on (provider, event_id). Same
  // pattern as Clerk + payment providers.
  const claim = await claimWebhookEvent('resend', svixId);
  if (claim.status === 'already_processed') {
    logger.info('resend_webhook_duplicate', { requestId, svixId, type: event.type });
    return new Response('OK', { status: 200 });
  }
  if (claim.status === 'in_flight') {
    logger.info('resend_webhook_in_flight', { requestId, svixId, type: event.type });
    return new Response('Processing in progress', { status: 503 });
  }
  if (claim.status === 'permanently_failed') {
    logger.error('resend_webhook_permanently_failed', { requestId, svixId, type: event.type });
    return new Response('OK', { status: 200 });
  }

  try {
    // Normalise recipient — Resend sends `to` as either a string or array.
    const data = event.data ?? {};
    const recipients = Array.isArray(data.to) ? data.to : data.to ? [data.to] : [];

    if (event.type === 'email.bounced') {
      // Error level — operators should see hard bounces. A recipient
      // whose mailbox is gone needs to be removed from any audience
      // before Resend rate-limits our sender.
      logger.error('resend_email_bounced', {
        requestId,
        svixId,
        emailId: data.email_id,
        from: data.from,
        to: recipients,
        subject: data.subject,
        bounceType: data.bounce?.subType,
        bounceMessage: data.bounce?.message,
      });
      // Audit pass-7 followup ⑤ (2026-05-25): suppress every bounced
      // recipient. `sendEmail` checks `isEmailSuppressed` before posting
      // to Resend, so we won't re-send to this address until an operator
      // retires the suppression. Suppress on ANY bounce subtype (hard /
      // soft / undetermined) — soft is theoretically transient but
      // operationally we'd rather a club admin manually retire than
      // re-burn the recipient mid-incident.
      for (const recipient of recipients) {
        await addEmailSuppression({
          email: recipient,
          reason: 'bounced',
          source: 'resend_webhook',
          bounceSubtype: data.bounce?.subType,
        });
      }
    } else if (event.type === 'email.complained') {
      // Spam complaint — most severe. Same recipient should never be
      // emailed again.
      logger.error('resend_email_complained', {
        requestId,
        svixId,
        emailId: data.email_id,
        from: data.from,
        to: recipients,
        subject: data.subject,
        feedbackType: data.complaint?.feedbackType,
      });
      // Audit pass-7 followup ⑤ (2026-05-25): suppress every complainant.
      for (const recipient of recipients) {
        await addEmailSuppression({
          email: recipient,
          reason: 'complained',
          source: 'resend_webhook',
        });
      }
    } else if (event.type === 'email.failed') {
      logger.warn('resend_email_failed', {
        requestId,
        svixId,
        emailId: data.email_id,
        from: data.from,
        to: recipients,
        subject: data.subject,
        reason: data.failed?.reason,
      });
    } else if (event.type === 'email.delivery_delayed') {
      logger.info('resend_email_delivery_delayed', {
        requestId,
        svixId,
        emailId: data.email_id,
      });
    } else if (NOOP_EVENT_TYPES.has(event.type)) {
      // Volume noise — we don't need delivery confirmations / open / click
      // events in our logs today. Dedup row still gets written so a
      // retry doesn't re-emit.
      logger.info('resend_event_ignored', { requestId, svixId, type: event.type });
    } else {
      logger.warn('resend_event_unhandled', { requestId, svixId, type: event.type });
    }

    await markWebhookEventProcessed('resend', svixId);
    return new Response('OK', { status: 200 });
  } catch (err) {
    logger.error('resend_webhook_processing_failed', {
      requestId,
      svixId,
      type: event.type,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    await markWebhookEventFailed(
      'resend',
      svixId,
      err instanceof Error ? err.message : 'Unknown error',
    );
    return new Response('Webhook processing failed', { status: 500 });
  }
}

// `ACTIONABLE_EVENT_TYPES` exported indirectly via TypeScript suppress —
// referenced here to keep the set live for the next iteration that adds
// suppression-list logic.
void ACTIONABLE_EVENT_TYPES;
