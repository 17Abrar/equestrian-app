import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../index';
import { emailSuppressions } from '../schema/operations';

/**
 * Audit pass-7 integration followup ⑤ (2026-05-25): suppression list
 * read/write helpers used by the Resend webhook handler and the email
 * send paths (`apps/web/lib/email.ts`, `apps/web/lib/email-support.ts`).
 *
 * Phase 1 of the integration audit shipped the Resend webhook handler
 * (PR #181) ingesting bounces/complaints at log-only level. Phase 2
 * (this) adds the table + check so we actually stop sending to those
 * addresses.
 */

export type SuppressionReason = 'bounced' | 'complained' | 'manual';
export type SuppressionSource = 'resend_webhook' | 'manual';

interface AddSuppressionArgs {
  email: string;
  reason: SuppressionReason;
  source: SuppressionSource;
  bounceSubtype?: string;
  notes?: string;
}

/**
 * Returns true when `email` should NOT be sent to. The "active" filter
 * (`retired_at IS NULL`) hits the partial index from migration 0063.
 *
 * Email comparison is lower-case to match RFC 5321 §2.3.11 — local-parts
 * are case-sensitive in principle but in practice nobody enforces that,
 * and Resend's webhook payloads aren't guaranteed case-stable. Storing
 * normalized + querying normalized keeps the lookup deterministic.
 */
export async function isEmailSuppressed(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  const rows = await db
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(
      and(
        eq(sql`lower(${emailSuppressions.email})`, normalized),
        isNull(emailSuppressions.retiredAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Add an email to the suppression list. Idempotent — if a row already
 * exists for this email and it's still active (`retired_at IS NULL`),
 * the new bounce/complaint is silently absorbed. If a row exists but is
 * retired, the existing row is re-activated by clearing `retired_at`
 * and the new reason/source/subtype are written over the old.
 *
 * Returns the resulting row (whether inserted or updated).
 */
export async function addEmailSuppression(args: AddSuppressionArgs): Promise<{
  email: string;
  inserted: boolean;
}> {
  const normalized = args.email.trim().toLowerCase();
  if (!normalized) {
    throw new Error('addEmailSuppression: email is required');
  }

  // ON CONFLICT (email) DO UPDATE — if a retired row exists we re-activate
  // it; if an active row exists we no-op the values (still updates
  // `created_at` would be wrong; instead we leave the existing
  // active row untouched by guarding the SET clause with WHERE).
  //
  // Drizzle doesn't expose a WHERE clause on `onConflictDoUpdate`, so do
  // a two-step: try INSERT ON CONFLICT DO NOTHING first; if no row
  // returned, the existing row is already there — check if it's retired
  // and re-activate.
  const insert = await db
    .insert(emailSuppressions)
    .values({
      email: normalized,
      reason: args.reason,
      source: args.source,
      bounceSubtype: args.bounceSubtype,
      notes: args.notes,
    })
    .onConflictDoNothing({ target: emailSuppressions.email })
    .returning({ id: emailSuppressions.id });

  if (insert[0]) {
    return { email: normalized, inserted: true };
  }

  // Conflict — row already exists. Re-activate if retired; otherwise no-op.
  await db
    .update(emailSuppressions)
    .set({
      reason: args.reason,
      source: args.source,
      bounceSubtype: args.bounceSubtype,
      notes: args.notes,
      retiredAt: null,
    })
    .where(
      and(
        eq(emailSuppressions.email, normalized),
        // Only overwrite when the existing row is retired — re-bouncing
        // a long-quiet address. An already-active row stays untouched
        // (we don't want noisy retries from the same provider to keep
        // resetting `created_at`).
        sql`${emailSuppressions.retiredAt} IS NOT NULL`,
      ),
    );

  return { email: normalized, inserted: false };
}

/**
 * Retire a suppression — flips `retired_at` so `isEmailSuppressed`
 * returns false going forward. Used by operator tooling (manual
 * unsuppress) and an admin-clear flow if/when that ships.
 */
export async function retireEmailSuppression(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const result = await db
    .update(emailSuppressions)
    .set({ retiredAt: new Date() })
    .where(
      and(
        eq(emailSuppressions.email, normalized),
        isNull(emailSuppressions.retiredAt),
      ),
    )
    .returning({ id: emailSuppressions.id });
  return result.length > 0;
}
