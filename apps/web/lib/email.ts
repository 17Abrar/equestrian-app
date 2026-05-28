import 'server-only';

import { render } from '@react-email/components';
import { after } from 'next/server';
import { rawDb } from '@equestrian/db';
import { clubs, type NotificationPreferences } from '@equestrian/db/schema';
import {
  isEmailSuppressed,
  recordEmailSend,
  updateEmailSendStatus,
} from '@equestrian/db/queries';
import type { EmailSendSource } from '@equestrian/db/schema';
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
const RESEND_BASE_URL = process.env.RESEND_BASE_URL ?? 'https://api.resend.com';
const RESEND_FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRY_AFTER_DELAY_MS = 15_000;
const RETRY_BACKOFFS_MS = [500, 1500] as const;

function resolveFromAddress(): string | null {
  const configured = process.env.EMAIL_FROM;
  if (configured && configured.trim().length > 0) {
    return configured;
  }
  if (process.env.NODE_ENV === 'production') {
    logger.error('email_from_unset_in_prod', {
      message:
        'EMAIL_FROM is not set; refusing to send transactional mail from the resend.dev sandbox sender',
    });
    return null;
  }
  return FALLBACK_FROM_ADDRESS;
}

function getResendApiKey(): string | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn('email_not_configured', {
      message: 'RESEND_API_KEY not set — emails will be skipped',
    });
    return null;
  }
  return apiKey;
}

interface SendEmailParams {
  to: string;
  subject: string;
  template: ReactElement;
  /**
   * Task #21 (2026-05-28): the sender's club. Passed to
   * `isEmailSuppressed` so manual suppressions are scoped — Club A's
   * manual entry blocks Club A's sends but not Club B's. Webhook
   * (bounce/complaint) rows are global and always honored. Operational
   * mail with no tenant context (system warnings, signups) leaves this
   * undefined and runs the webhook-only check.
   */
  clubId?: string;
  /**
   * Task #22 (2026-05-28): opt-in send-log entry. Recorded before the
   * suppression check and updated to its terminal state after Resend
   * resolves. Skipped when omitted to keep transactional sends that
   * don't want logging cheap. `clubId` is required when sendLog is set
   * (the row must scope to a tenant).
   */
  sendLog?: SendLogContext;
  /**
   * Internal — when set, sendEmail SKIPS its own recordEmailSend and
   * uses this id for the status update instead. `sendWithRetry`
   * hoists the log row to the first attempt and reuses it across
   * retries, so the "Recently sent" UI shows one row per logical
   * send (codex #22 P3). Callers should pass `sendLog`, not this.
   */
  existingLogId?: string;
}

interface SendPlainTextEmailParams {
  to: string;
  subject: string;
  text: string;
  clubId?: string;
  sendLog?: SendLogContext;
  existingLogId?: string;
}

interface SendLogContext {
  source: EmailSendSource;
  senderMemberId?: string | null;
  audienceId?: string | null;
  trigger?: string | null;
}

export interface EmailSendResult {
  sent: boolean;
  id?: string;
  error?: string;
  retryAfterMs?: number;
  skipped?: boolean;
}

interface ResendEmailPayload {
  from: string;
  to: string[];
  subject: string;
  html?: string;
  text?: string;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

function readStringField(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const candidate = record[field];
  return typeof candidate === 'string' ? candidate : undefined;
}

async function parseResendError(response: Response): Promise<string> {
  const raw = await response.text().catch(() => '');
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const message = readStringField(parsed, 'message');
      if (message) return message;
    } catch {
      return raw.slice(0, 500);
    }
  }
  return response.statusText || 'Resend request failed';
}

async function postResendEmail(payload: ResendEmailPayload): Promise<EmailSendResult> {
  const apiKey = getResendApiKey();
  if (!apiKey) {
    return { sent: false, error: 'Email not configured' };
  }

  try {
    const response = await fetch(`${RESEND_BASE_URL}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RESEND_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        sent: false,
        error: await parseResendError(response),
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after')),
      };
    }

    const data: unknown = await response.json().catch(() => null);
    return { sent: true, id: readStringField(data, 'id') };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : 'Unable to reach Resend',
    };
  }
}

/**
 * Sends an email using Resend + React Email template.
 * Fire-and-forget — never throws. Returns success/failure status.
 * If RESEND_API_KEY is not set, silently skips.
 */
export async function sendEmail(params: SendEmailParams): Promise<EmailSendResult> {
  // Task #22 (2026-05-28): opt-in send-log row. Recorded as 'queued'
  // up front so the UI sees the attempt even when the send itself
  // never completes (process crash, isolate kill). Caller must
  // provide clubId — the row must scope to a tenant.
  //
  // When `existingLogId` is set, sendWithRetry has already hoisted
  // the recordEmailSend call to the first attempt and is reusing the
  // same row across retries (codex #22 P3). Skip the insert in that
  // case.
  const sendLogId =
    params.existingLogId ??
    (params.sendLog && params.clubId
      ? await recordEmailSend({
          clubId: params.clubId,
          senderMemberId: params.sendLog.senderMemberId,
          toEmail: params.to,
          subject: params.subject,
          audienceId: params.sendLog.audienceId,
          trigger: params.sendLog.trigger,
          source: params.sendLog.source,
          status: 'queued',
        })
      : null);

  const fromAddress = resolveFromAddress();
  if (!fromAddress) {
    // Already logged via `email_from_unset_in_prod` in resolveFromAddress.
    // Codex #22 iter-2 P3 (2026-05-28): close the log row so the UI
    // never shows a permanently-stuck 'queued' send when EMAIL_FROM
    // is unset in prod.
    const error = 'EMAIL_FROM not configured in production';
    if (sendLogId && params.clubId) {
      await updateEmailSendStatus({
        id: sendLogId,
        clubId: params.clubId,
        status: 'failed',
        error,
      });
    }
    return { sent: false, error };
  }

  // Audit pass-7 followup ⑤ (2026-05-25): suppression-list check. The
  // Resend webhook handler inserts rows on `email.bounced` /
  // `email.complained` events; this short-circuit prevents us from
  // re-sending to a recipient whose mailbox is gone or who marked us
  // as spam. Critical for protecting Resend sender reputation in a
  // multi-tenant SaaS where one club's bad list would burn deliverability
  // for every other club. Operator can retire a suppression via
  // `retireEmailSuppression` when the recipient asks to be re-added.
  //
  // Codex #22 iter-5 P3 (2026-05-28): wrap in try/catch so a DB blip
  // on the suppression lookup doesn't escape the function — that would
  // bypass the retry catch (sendWithRetry awaits sendEmail and lets
  // throws propagate) and leave the send-log row stuck 'queued'.
  // Fail-open: if we can't check suppression, attempt the send. Webhook
  // suppressions are a deliverability protection, not a hard correctness
  // gate, and the alternative ("never send anything if the DB is
  // flaky") would silently drop transactional mail.
  let suppressed = false;
  try {
    suppressed = await isEmailSuppressed(params.to, params.clubId);
  } catch (err) {
    logger.warn('email_suppression_check_failed', {
      to: params.to,
      subject: params.subject,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (suppressed) {
    logger.warn('email_skipped_by_suppression', {
      to: params.to,
      subject: params.subject,
    });
    if (sendLogId && params.clubId) {
      await updateEmailSendStatus({
        id: sendLogId,
        clubId: params.clubId,
        status: 'suppressed',
        error: 'recipient is on the suppression list',
      });
    }
    return { sent: false, error: 'recipient is on the suppression list' };
  }

  try {
    const html = await render(params.template);

    const result = await postResendEmail({
      from: fromAddress,
      to: [params.to],
      subject: params.subject,
      html,
    });

    if (!result.sent) {
      logger.error('email_send_failed', {
        to: params.to,
        subject: params.subject,
        error: result.error,
      });
      if (sendLogId && params.clubId) {
        await updateEmailSendStatus({
          id: sendLogId,
          clubId: params.clubId,
          status: 'failed',
          error: result.error ?? 'send failed',
        });
      }
      return result;
    }

    logger.info('email_sent', {
      to: params.to,
      subject: params.subject,
      id: result.id,
    });

    if (sendLogId && params.clubId) {
      await updateEmailSendStatus({
        id: sendLogId,
        clubId: params.clubId,
        status: 'sent',
        resendId: result.id ?? null,
      });
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('email_send_error', {
      to: params.to,
      subject: params.subject,
      error: message,
    });
    if (sendLogId && params.clubId) {
      await updateEmailSendStatus({
        id: sendLogId,
        clubId: params.clubId,
        status: 'failed',
        error: message,
      });
    }
    return { sent: false, error: message };
  }
}

export async function sendPlainTextEmail(
  params: SendPlainTextEmailParams,
): Promise<EmailSendResult> {
  // Task #22 (2026-05-28): mirrors `sendEmail` — opt-in send-log
  // tracking, written before the suppression check and updated to its
  // terminal state after Resend resolves. See the same comment in
  // `sendEmail` re: the existingLogId hoist for retries.
  const sendLogId =
    params.existingLogId ??
    (params.sendLog && params.clubId
      ? await recordEmailSend({
          clubId: params.clubId,
          senderMemberId: params.sendLog.senderMemberId,
          toEmail: params.to,
          subject: params.subject,
          audienceId: params.sendLog.audienceId,
          trigger: params.sendLog.trigger,
          source: params.sendLog.source,
          status: 'queued',
        })
      : null);

  const fromAddress = resolveFromAddress();
  if (!fromAddress) {
    const error = 'EMAIL_FROM not configured in production';
    if (sendLogId && params.clubId) {
      await updateEmailSendStatus({
        id: sendLogId,
        clubId: params.clubId,
        status: 'failed',
        error,
      });
    }
    return { sent: false, error };
  }

  // Audit pass-7 followup ⑤ (2026-05-25): suppression-list check —
  // mirrors `sendEmail`. Plain-text path is used for system notices,
  // same suppression contract applies. See `sendEmail` for the
  // codex #22 iter-5 P3 rationale on the fail-open try/catch.
  let suppressed = false;
  try {
    suppressed = await isEmailSuppressed(params.to, params.clubId);
  } catch (err) {
    logger.warn('email_suppression_check_failed', {
      to: params.to,
      subject: params.subject,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (suppressed) {
    logger.warn('email_skipped_by_suppression', {
      to: params.to,
      subject: params.subject,
    });
    if (sendLogId && params.clubId) {
      await updateEmailSendStatus({
        id: sendLogId,
        clubId: params.clubId,
        status: 'suppressed',
        error: 'recipient is on the suppression list',
      });
    }
    return { sent: false, error: 'recipient is on the suppression list' };
  }

  const result = await postResendEmail({
    from: fromAddress,
    to: [params.to],
    subject: params.subject,
    text: params.text,
  });

  if (!result.sent) {
    logger.error('email_send_failed', {
      to: params.to,
      subject: params.subject,
      error: result.error,
    });
    if (sendLogId && params.clubId) {
      await updateEmailSendStatus({
        id: sendLogId,
        clubId: params.clubId,
        status: 'failed',
        error: result.error ?? 'send failed',
      });
    }
    return result;
  }

  logger.info('email_sent', {
    to: params.to,
    subject: params.subject,
    id: result.id,
  });

  if (sendLogId && params.clubId) {
    await updateEmailSendStatus({
      id: sendLogId,
      clubId: params.clubId,
      status: 'sent',
      resendId: result.id ?? null,
    });
  }

  return result;
}

/**
 * Retries `send` up to `maxAttempts` times with bounded backoff. Stops on the
 * first `{ sent: true }`. Used by the fire-and-forget paths so a Resend blip
 * during the post-response window doesn't permanently drop transactional
 * email (booking confirmations, livery invoices). Normal backoff is ~2.2s;
 * Resend `Retry-After` is honoured up to 15s per retry so rate-limit bursts
 * do not immediately hammer the API again.
 */
async function sendWithRetry(
  send: () => Promise<EmailSendResult>,
  context: { to: string; subject: string; trigger?: NotificationTrigger; clubId?: string },
): Promise<EmailSendResult> {
  const maxAttempts = RETRY_BACKOFFS_MS.length + 1;
  let finalResult: EmailSendResult = { sent: false, error: 'Email send was not attempted' };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await send();
    finalResult = result;
    if (result.sent) return result;
    if (attempt < maxAttempts) {
      // sendEmail already logged this attempt at `email_send_failed`; the
      // retry log here gives the operator a single grep-friendly event to
      // see how many retries it took without re-walking the failed-send
      // events. Jitter so concurrent failures don't all retry in lockstep.
      const base = RETRY_BACKOFFS_MS[attempt - 1]!;
      const retryAfterMs = result.retryAfterMs;
      const delayBase =
        retryAfterMs !== undefined ? Math.min(retryAfterMs, MAX_RETRY_AFTER_DELAY_MS) : base;
      const delay =
        retryAfterMs !== undefined ? delayBase : delayBase + Math.floor(Math.random() * 250);
      logger.warn('email_send_retry_scheduled', {
        ...context,
        attempt,
        nextDelayMs: delay,
        retryAfterMs,
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
  return finalResult;
}

/**
 * Task #22 (2026-05-28): hoists the recordEmailSend call so retries
 * share a single log row (codex P3). The first attempt inserts as
 * 'queued'; every subsequent attempt sees `existingLogId` and only
 * updates the existing row's status.
 */
async function hoistSendLog(
  params: { clubId?: string; to: string; subject: string; sendLog?: SendLogContext },
): Promise<string | null> {
  if (!params.sendLog || !params.clubId) return null;
  return recordEmailSend({
    clubId: params.clubId,
    senderMemberId: params.sendLog.senderMemberId,
    toEmail: params.to,
    subject: params.subject,
    audienceId: params.sendLog.audienceId,
    trigger: params.sendLog.trigger,
    source: params.sendLog.source,
    status: 'queued',
  });
}

/**
 * Codex #22 iter-4 P3 (2026-05-28): when a wrapper hoists but the
 * insert fails (recordEmailSend swallows the error and returns null),
 * we MUST clear `sendLog` on the child params. Otherwise the
 * primitive sendEmail/sendPlainTextEmail path falls back to a fresh
 * insert on every retry — exactly the double-insert codex flagged.
 * Strip sendLog so the retries treat the send as untracked.
 */
function buildChildParams<T extends SendEmailParams | SendPlainTextEmailParams>(
  params: T,
  hoistedId: string | null,
): T {
  if (params.existingLogId) {
    // Caller already had a row; honour it.
    return params;
  }
  if (hoistedId) {
    return { ...params, existingLogId: hoistedId };
  }
  // Hoist attempted but failed (or the wrapper had no clubId/sendLog).
  // Either way, suppress further insert attempts in the retry loop.
  return { ...params, sendLog: undefined, existingLogId: undefined };
}

export async function sendEmailWithRetry(params: SendEmailParams): Promise<EmailSendResult> {
  // Codex #22 iter-2 P3 (2026-05-28): `existingLogId` from the caller
  // wins — only hoist a new row when one wasn't already provided.
  // Without this, a wrapper-of-a-wrapper would double-insert.
  const hoistedId = params.existingLogId ? null : await hoistSendLog(params);
  const childParams = buildChildParams(params, hoistedId);
  return sendWithRetry(() => sendEmail(childParams), {
    to: params.to,
    subject: params.subject,
  });
}

export async function sendPlainTextEmailWithRetry(
  params: SendPlainTextEmailParams,
): Promise<EmailSendResult> {
  const hoistedId = params.existingLogId ? null : await hoistSendLog(params);
  const childParams = buildChildParams(params, hoistedId);
  return sendWithRetry(() => sendPlainTextEmail(childParams), {
    to: params.to,
    subject: params.subject,
  });
}

/**
 * Sends an email after the response is flushed. Uses Next.js `after()` so
 * the task completes even on Cloudflare Workers, which otherwise freezes
 * the isolate after the response returns and kills any unawaited promises.
 *
 * Retries transient failures with bounded backoff. Normal backoff is ~2.2s;
 * Resend `Retry-After` can extend an individual delay to 15s. Permanent
 * failures (invalid recipient, template render error) exhaust retries and
 * log `email_send_exhausted` at error level for paging.
 *
 * Safe to call from any request handler; falls back to bare fire-and-forget
 * if called outside a request context (e.g. from a script).
 */
export function sendEmailAsync(params: SendEmailParams): void {
  const task = async () => {
    // Codex #22 iter-3 P3 (2026-05-28): hoist the send-log row so
    // retries share one row, matching sendEmailWithRetry. Without
    // this, a caller passing `sendLog` would get a fresh queued/
    // failed row per attempt. Codex #22 iter-4 P3: also clear
    // sendLog when the hoist itself fails (recordEmailSend swallows
    // errors), so retries don't fall through to per-attempt inserts.
    const hoistedId = params.existingLogId ? null : await hoistSendLog(params);
    const childParams = buildChildParams(params, hoistedId);
    return sendWithRetry(() => sendEmail(childParams), {
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
  };
  try {
    after(task);
  } catch (err) {
    // `after()` throws when called outside a request lifecycle (e.g. from
    // a cron run or background job that didn't establish one). Log so a
    // Worker-isolate kill is observable instead of silently dropping the
    // email — audit QA-32l.
    logger.warn('email_after_unavailable_falling_back_to_void', {
      to: params.to,
      subject: params.subject,
      error: err instanceof Error ? err.message : String(err),
    });
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
export async function sendTriggeredEmail(params: TriggeredEmailParams): Promise<EmailSendResult> {
  const { clubId, trigger, ...emailParams } = params;
  const enabled = await isNotificationEnabled(clubId, trigger);
  if (!enabled) {
    logger.info('email_skipped_by_preference', {
      clubId,
      trigger,
      to: emailParams.to,
      subject: emailParams.subject,
    });
    return {
      sent: false,
      skipped: true,
      error: 'Email disabled by notification preference',
    };
  }
  // Task #21 (2026-05-28): forward clubId to the send so
  // `isEmailSuppressed` honours this club's manual suppressions.
  // Triggered emails always know their club; passing it makes per-club
  // manual suppressions effective for every transactional path.
  //
  // Task #22 (2026-05-28): auto-attach a transactional send-log entry
  // tagged with the trigger. Callers may override by passing their own
  // `sendLog` on the params; this default fills the common case.
  const sendLog: SendLogContext = emailParams.sendLog ?? {
    source: 'transactional',
    trigger,
  };
  // Hoist the send-log row so retries reuse it (codex #22 P3). When
  // the caller already passed an existingLogId (e.g., a wrapper that
  // hoisted earlier), honour that and skip the second insert (codex
  // #22 iter-2 P3). If the hoist itself fails, strip sendLog so
  // retries don't fall back to per-attempt inserts (codex #22 iter-4
  // P3).
  const hoistedId = emailParams.existingLogId
    ? null
    : await hoistSendLog({
        clubId,
        to: emailParams.to,
        subject: emailParams.subject,
        sendLog,
      });
  const childParams: SendEmailParams = buildChildParams(
    { ...emailParams, clubId, sendLog },
    hoistedId,
  );
  return sendWithRetry(() => sendEmail(childParams), {
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
  } catch (err) {
    // Same fallback rationale as the parent helper — audit QA-32l.
    logger.warn('email_after_unavailable_falling_back_to_void', {
      clubId: params.clubId,
      trigger: params.trigger,
      to: params.to,
      subject: params.subject,
      error: err instanceof Error ? err.message : String(err),
    });
    void task();
  }
}
