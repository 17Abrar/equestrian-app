/**
 * Submit a waitlist entry to a Google Apps Script web app, which appends
 * a row to a Google Sheet. Same pattern as the JSR check-in kiosk, so
 * operating the spreadsheet (triage, export, share) is already familiar.
 *
 * The Apps Script endpoint is the "deployment URL" of a `doPost(e)`
 * handler published as a web app with execute-as the script owner and
 * access set to "Anyone." Apps Script issues a shared-secret-free URL
 * that's hard to discover but not cryptographically protected, so we
 * still rate-limit the public API route in front of this client.
 *
 * Required env binding (Cloudflare Workers secret):
 *
 *   WAITLIST_WEBHOOK_URL  — the Apps Script web-app URL
 *                           (looks like https://script.google.com/macros/s/AKfyc.../exec).
 *
 * See `ENV.md` and the Apps Script attached to the Cavaliq Waitlist
 * sheet for setup steps.
 */

import { logger } from './logger';

const WEBHOOK_TIMEOUT_MS = 10_000;

export interface WaitlistSubmission {
  email: string;
  name: string;
  clubName: string;
  country: 'UAE' | 'KSA' | 'Qatar' | 'Bahrain' | 'Kuwait' | 'Oman' | 'Other';
  role: 'Owner' | 'Manager' | 'Coach' | 'Other';
  source: string;
}

export class WaitlistConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaitlistConfigError';
  }
}

export class WaitlistWebhookError extends Error {
  public readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'WaitlistWebhookError';
    this.status = status;
  }
}

function readWebhookUrl(): string {
  const url = process.env.WAITLIST_WEBHOOK_URL;
  if (!url) {
    throw new WaitlistConfigError('WAITLIST_WEBHOOK_URL must be set');
  }
  return url;
}

/**
 * Submit a waitlist entry. Throws `WaitlistConfigError` if env is
 * missing, `WaitlistWebhookError` for any non-2xx response. The caller
 * translates these into the API envelope.
 */
export async function submitWaitlistEntry(submission: WaitlistSubmission): Promise<void> {
  const webhookUrl = readWebhookUrl();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  // Apps Script's `doPost(e)` reads JSON bodies from `e.postData.contents`
  // when the request is Content-Type: application/json. The script can
  // then `JSON.parse(e.postData.contents)` and append the row.
  const body = JSON.stringify({
    receivedAt: new Date().toISOString(),
    email: submission.email,
    name: submission.name,
    clubName: submission.clubName,
    country: submission.country,
    role: submission.role,
    source: submission.source,
  });

  let response: Response;
  try {
    response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
      // Apps Script web apps respond with a 302 to googleusercontent.com
      // that carries the actual response body. `redirect: 'follow'` is
      // the default in Workers and resolves that hop transparently.
      redirect: 'follow',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new WaitlistWebhookError('Waitlist webhook timed out', 504);
    }
    throw new WaitlistWebhookError(
      err instanceof Error ? err.message : 'Waitlist webhook request failed',
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  // Apps Script's `ContentService` cannot set arbitrary HTTP status
  // codes — every response is HTTP 200, even when the script's
  // `doPost(e)` catches an exception. Inspect the response body
  // (`{ success: boolean, error?: string }`, defined in the
  // companion `scripts/waitlist-apps-script.gs`) instead of relying on
  // `response.ok`, which would always pass.
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    logger.error('waitlist_webhook_failed', {
      status: response.status,
      body: text.slice(0, 500),
    });
    throw new WaitlistWebhookError(`Waitlist webhook returned ${response.status}`, response.status);
  }

  let parsed: { success?: boolean; error?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.error('waitlist_webhook_invalid_body', { body: text.slice(0, 500) });
    throw new WaitlistWebhookError('Waitlist webhook returned non-JSON body', 502);
  }

  if (!parsed.success) {
    logger.error('waitlist_webhook_script_error', { scriptError: parsed.error });
    throw new WaitlistWebhookError(parsed.error ?? 'Waitlist webhook reported failure', 502);
  }
}
