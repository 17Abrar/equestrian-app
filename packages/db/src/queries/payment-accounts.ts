import { eq, and, asc, gte, sql } from 'drizzle-orm';
import { db, rawDb, writeTransaction } from '../index';
import { clubPaymentAccounts } from '../schema/finances';
import { bookings } from '../schema/bookings';
import { liveryInvoices } from '../schema/livery-invoices';
import { encryptField, decryptField } from '../crypto';

type NewPaymentAccount = typeof clubPaymentAccounts.$inferInsert;
type PaymentAccountRow = typeof clubPaymentAccounts.$inferSelect;

export type PaymentProvider = PaymentAccountRow['provider'];
export type PaymentAccountStatus = PaymentAccountRow['status'];

/**
 * Shape of the decrypted credentials JSON stored in `encrypted_credentials`.
 * Every provider defines its own shape; downstream adapters validate at runtime.
 */
export interface DecryptedCredentials {
  [key: string]: unknown;
}

/** Row returned to UI/API responses. Secrets are stripped. */
export interface PaymentAccountSummary {
  id: string;
  clubId: string;
  provider: PaymentProvider;
  status: PaymentAccountStatus;
  isActive: boolean;
  externalAccountId: string | null;
  metadata: unknown;
  lastError: string | null;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Row returned to provider adapters that need to authenticate against the provider API. */
export interface PaymentAccountWithCredentials extends PaymentAccountSummary {
  credentials: DecryptedCredentials | null;
}

function toSummary(row: PaymentAccountRow): PaymentAccountSummary {
  const { encryptedCredentials: _secret, ...rest } = row;
  return rest;
}

function toWithCredentials(row: PaymentAccountRow): PaymentAccountWithCredentials {
  const summary = toSummary(row);
  if (!row.encryptedCredentials) {
    return { ...summary, credentials: null };
  }
  const plaintext = decryptField(row.encryptedCredentials);
  if (!plaintext) {
    // AES-GCM auth-tag verification failed (or the row predates the v1: prefix
    // and isn't valid plaintext either). Without this log, a key rotation
    // without re-encryption surfaces downstream as the misleading "secret not
    // configured" 503 from webhook routes — the operator wastes hours hunting
    // a config issue while every signature check fails. Use console.warn for
    // the same reason as the JSON.parse branch below: this package can't
    // import the app-side logger without a circular dep.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'payment_account_credentials_decrypt_failed',
        timestamp: new Date().toISOString(),
        clubId: row.clubId,
        provider: row.provider,
        accountId: row.id,
      }),
    );
    return { ...summary, credentials: null };
  }
  try {
    return { ...summary, credentials: JSON.parse(plaintext) as DecryptedCredentials };
  } catch (err) {
    // Use console.warn with a structured payload because this package can't
    // import the app-side logger without a circular dep. Without this line, a
    // corrupted credentials blob (e.g., ENCRYPTION_KEY rotated without
    // re-encrypting rows, or a truncated ciphertext) silently looks like
    // "no credentials configured" — webhook signature checks then log a
    // misleading "secret not configured" and the operator has no path back to
    // the real cause.
    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'payment_account_credentials_unparseable',
        timestamp: new Date().toISOString(),
        clubId: row.clubId,
        provider: row.provider,
        accountId: row.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ...summary, credentials: null };
  }
}

/** Lists every payment account for a club — for settings / connected-accounts UI. */
export async function listPaymentAccounts(
  clubId: string,
  { page, pageSize }: { page: number; pageSize: number },
): Promise<{ items: PaymentAccountSummary[]; total: number }> {
  const offset = (page - 1) * pageSize;
  const where = eq(clubPaymentAccounts.clubId, clubId);
  const [rows, count] = await Promise.all([
    db
      .select()
      .from(clubPaymentAccounts)
      .where(where)
      .orderBy(asc(clubPaymentAccounts.provider))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(clubPaymentAccounts)
      .where(where),
  ]);

  return { items: rows.map(toSummary), total: count[0]?.count ?? 0 };
}

/** Returns the one active account, or null if no provider is connected yet. */
export async function getActivePaymentAccount(
  clubId: string,
): Promise<PaymentAccountWithCredentials | null> {
  const rows = await db
    .select()
    .from(clubPaymentAccounts)
    .where(
      and(
        eq(clubPaymentAccounts.clubId, clubId),
        eq(clubPaymentAccounts.isActive, true),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? toWithCredentials(row) : null;
}

export async function getPaymentAccountByProvider(
  clubId: string,
  provider: PaymentProvider,
): Promise<PaymentAccountWithCredentials | null> {
  const rows = await db
    .select()
    .from(clubPaymentAccounts)
    .where(
      and(
        eq(clubPaymentAccounts.clubId, clubId),
        eq(clubPaymentAccounts.provider, provider),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? toWithCredentials(row) : null;
}

interface UpsertInput {
  provider: PaymentProvider;
  status: PaymentAccountStatus;
  externalAccountId?: string | null;
  credentials?: DecryptedCredentials | null;
  metadata?: unknown;
  makeActive?: boolean;
}

/**
 * Creates a new payment account for the provider, or updates the existing
 * one. When `makeActive` is true, this also marks the provider as the club's
 * active payment processor (and deactivates any previously active one) in
 * the same transaction.
 */
export async function upsertPaymentAccount(
  clubId: string,
  input: UpsertInput,
): Promise<PaymentAccountSummary> {
  return writeTransaction(async (tx) => {
    if (input.makeActive) {
      await tx
        .update(clubPaymentAccounts)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(clubPaymentAccounts.clubId, clubId));
    }

    const encryptedCredentials = input.credentials
      ? encryptField(JSON.stringify(input.credentials))
      : null;

    const values: NewPaymentAccount = {
      clubId,
      provider: input.provider,
      status: input.status,
      externalAccountId: input.externalAccountId ?? null,
      encryptedCredentials,
      metadata: input.metadata ?? null,
      isActive: input.makeActive ?? false,
      connectedAt: input.status === 'connected' ? new Date() : null,
      updatedAt: new Date(),
    };

    const [row] = await tx
      .insert(clubPaymentAccounts)
      .values(values)
      .onConflictDoUpdate({
        target: [clubPaymentAccounts.clubId, clubPaymentAccounts.provider],
        set: {
          status: values.status,
          externalAccountId: values.externalAccountId,
          encryptedCredentials: values.encryptedCredentials,
          metadata: values.metadata,
          isActive: values.isActive,
          connectedAt: values.connectedAt,
          disconnectedAt: null,
          lastError: null,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) {
      throw new Error('Failed to upsert payment account');
    }
    return toSummary(row);
  });
}

/**
 * Atomically switches the active provider. At most one account per club can
 * be `is_active = true` — enforced here and intended to be monitored via the
 * `idx_payment_accounts_active` index.
 */
export async function setActiveProvider(
  clubId: string,
  provider: PaymentProvider,
): Promise<PaymentAccountSummary | null> {
  return writeTransaction(async (tx) => {
    // Audit MED-7 (2026-05-05): pre-check the target before touching
    // any state. The previous implementation deactivated all rows
    // first, then tried to activate the requested one — if the target
    // didn't exist or wasn't `connected`, the deactivation committed
    // and the club was left with NO active provider, silently
    // returning null. Pre-check turns that into a clean rollback.
    const [target] = await tx
      .select({
        id: clubPaymentAccounts.id,
        status: clubPaymentAccounts.status,
      })
      .from(clubPaymentAccounts)
      .where(
        and(
          eq(clubPaymentAccounts.clubId, clubId),
          eq(clubPaymentAccounts.provider, provider),
        ),
      )
      .limit(1);

    if (!target || target.status !== 'connected') {
      // Throw inside writeTransaction → rollback → no state change.
      // Caller's catch maps this to a 422.
      throw new Error('PROVIDER_NOT_ACTIVATABLE');
    }

    await tx
      .update(clubPaymentAccounts)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(clubPaymentAccounts.clubId, clubId));

    const [row] = await tx
      .update(clubPaymentAccounts)
      .set({ isActive: true, updatedAt: new Date() })
      .where(
        and(
          eq(clubPaymentAccounts.clubId, clubId),
          eq(clubPaymentAccounts.provider, provider),
          eq(clubPaymentAccounts.status, 'connected'),
        ),
      )
      .returning();

    return row ? toSummary(row) : null;
  });
}

/**
 * Disables (soft-disconnects) the account for a given provider. The row is
 * kept so that historical payments referencing it still resolve, but it is
 * no longer eligible to process new charges.
 */
export async function disconnectPaymentAccount(
  clubId: string,
  provider: PaymentProvider,
): Promise<PaymentAccountSummary | null> {
  const [row] = await db
    .update(clubPaymentAccounts)
    .set({
      status: 'disabled',
      isActive: false,
      disconnectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clubPaymentAccounts.clubId, clubId),
        eq(clubPaymentAccounts.provider, provider),
      ),
    )
    .returning();

  return row ? toSummary(row) : null;
}

/** Records a provider-side error (e.g., from a webhook) for display in settings. */
export async function recordPaymentAccountError(
  clubId: string,
  provider: PaymentProvider,
  message: string,
): Promise<void> {
  await db
    .update(clubPaymentAccounts)
    .set({
      status: 'error',
      lastError: message.slice(0, 2048),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clubPaymentAccounts.clubId, clubId),
        eq(clubPaymentAccounts.provider, provider),
      ),
    );
}

/**
 * Webhook-time lookup: resolve a payment account (and its club) from the
 * provider's external id. Uses `rawDb` intentionally — webhook handlers have
 * no tenant context yet, so RLS would otherwise block the read.
 *
 * Only call this from webhook routes; in-app code should use the tenant-scoped
 * `getPaymentAccountByProvider`.
 *
 * Filters out `disabled` accounts (audit B-25): a club that disconnected
 * but whose row remained will keep receiving Stripe webhooks for in-flight
 * sessions, and we should NOT apply those payments to bookings — the
 * club no longer wants this provider, and the row stays only as an audit
 * trail. Returning null here pushes the webhook handler down the
 * "no booking matched" branch, which acks 200 silently.
 */
export async function findPaymentAccountByExternalId(
  externalAccountId: string,
  provider: PaymentProvider,
): Promise<PaymentAccountWithCredentials | null> {
  const rows = await rawDb
    .select()
    .from(clubPaymentAccounts)
    .where(
      and(
        eq(clubPaymentAccounts.externalAccountId, externalAccountId),
        eq(clubPaymentAccounts.provider, provider),
        sql`${clubPaymentAccounts.status} != 'disabled'`,
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? toWithCredentials(row) : null;
}

/**
 * Webhook-time lookup: given a known clubId (e.g., extracted from a per-club
 * webhook URL), return that club's account for the given provider. Uses
 * `rawDb` because webhooks run outside any tenant context.
 */
export async function adminGetPaymentAccountByProvider(
  clubId: string,
  provider: PaymentProvider,
): Promise<PaymentAccountWithCredentials | null> {
  const rows = await rawDb
    .select()
    .from(clubPaymentAccounts)
    .where(
      and(
        eq(clubPaymentAccounts.clubId, clubId),
        eq(clubPaymentAccounts.provider, provider),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? toWithCredentials(row) : null;
}

/**
 * Cron-time equivalent of getActivePaymentAccount: returns the club's active
 * provider (if any) using rawDb so it works outside a tenant transaction.
 */
export async function adminGetActivePaymentAccount(
  clubId: string,
): Promise<PaymentAccountWithCredentials | null> {
  const rows = await rawDb
    .select()
    .from(clubPaymentAccounts)
    .where(
      and(
        eq(clubPaymentAccounts.clubId, clubId),
        eq(clubPaymentAccounts.isActive, true),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row ? toWithCredentials(row) : null;
}

/**
 * Webhook-time lookup: resolve `{ clubId, bookingId }` from a provider's
 * payment id. Used when the webhook payload doesn't carry the club id in a
 * header/URL and we must trace back through the booking row. Uses `rawDb`.
 *
 * Audit F-11 / F-18 (2026-05-07 r5): when the caller has the URL's
 * clubId in hand — every per-club webhook receiver does, since the URL
 * pattern is `/api/webhooks/<provider>/[clubId]` — pass it here. The
 * lookup binds `(providerPaymentId, provider)` AND `clubId`, so a
 * future cross-tenant `provider_payment_id` collision (Ziina docs
 * reserve the right to reuse intent ids across merchants under
 * specific edge cases; Stripe Connect platform tenants share `pi_…`
 * namespace) can never resolve to another club's booking. Optional
 * for legacy callers; mirrors `findLiveryInvoiceByProviderPayment`'s
 * signature exactly.
 */
export async function findBookingByProviderPaymentId(
  providerPaymentId: string,
  provider: PaymentProvider,
  clubId?: string,
): Promise<{
  clubId: string;
  bookingId: string;
  currentPaymentStatus: string;
  bookingStatus: string;
  amount: number | null;
  /** Running refunded total in minor units. Audit HIGH-3 (2026-05-05):
   *  needed by the webhook helper to convert a provider's CUMULATIVE
   *  refund total (Stripe `charge.amount_refunded` in the empty-
   *  `refunds.data` fallback path) into a true delta. */
  refundedAmountMinor: number;
  currency: string;
} | null> {
  const conditions = [
    eq(bookings.providerPaymentId, providerPaymentId),
    eq(bookings.paymentProvider, provider),
  ];
  if (clubId) {
    conditions.push(eq(bookings.clubId, clubId));
  }
  const rows = await rawDb
    .select({
      id: bookings.id,
      clubId: bookings.clubId,
      paymentStatus: bookings.paymentStatus,
      status: bookings.status,
      amount: bookings.amount,
      refundedAmountMinor: bookings.refundedAmountMinor,
      currency: bookings.currency,
    })
    .from(bookings)
    .where(and(...conditions))
    .limit(1);

  const row = rows[0];
  return row
    ? {
        clubId: row.clubId,
        bookingId: row.id,
        currentPaymentStatus: row.paymentStatus,
        bookingStatus: row.status,
        amount: row.amount,
        refundedAmountMinor: row.refundedAmountMinor,
        currency: row.currency,
      }
    : null;
}

/**
 * Webhook-time lookup by booking id, scoped to the club resolved from the
 * event's provider account id. Used as a fallback when the
 * `provider_payment_id` lookup misses — fast-succeed payment webhooks can
 * arrive between `adapter.createPayment` returning and the route writing
 * the id back to the booking row, leaving the id-based lookup empty for a
 * booking that definitively exists.
 *
 * Returns `null` if the booking doesn't exist or doesn't belong to the
 * claimed club (a webhook signed by Club A claiming a booking from Club B
 * is either a replay attack or a config bug — either way, reject).
 *
 * `currentProviderPaymentId` is returned so the caller can detect the
 * TOCTOU (it'll be `null`) and store the provider id while it's updating
 * the status.
 */
export async function findBookingByIdForWebhook(
  bookingId: string,
  clubId: string,
): Promise<{
  clubId: string;
  bookingId: string;
  currentPaymentStatus: string;
  currentProviderPaymentId: string | null;
  /** Booking lifecycle status — webhooks must refuse to flip a cancelled/no_show
   * booking to paid (audit AI-24). */
  bookingStatus: string;
  /** Captured amount in minor units. Webhook reconciles against this before
   * marking the booking paid (audit AI-21). */
  amount: number | null;
  /** Audit HIGH-3 (2026-05-05): refunded-so-far for cumulative→delta
   *  conversion in the empty-`refunds.data` fallback path. */
  refundedAmountMinor: number;
  /** ISO-4217 code stamped at booking time. Webhook compares against the
   * provider event's currency to refuse cross-currency mark-paid. */
  currency: string;
} | null> {
  const rows = await rawDb
    .select({
      id: bookings.id,
      clubId: bookings.clubId,
      paymentStatus: bookings.paymentStatus,
      providerPaymentId: bookings.providerPaymentId,
      status: bookings.status,
      amount: bookings.amount,
      refundedAmountMinor: bookings.refundedAmountMinor,
      currency: bookings.currency,
    })
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.clubId, clubId)))
    .limit(1);

  const row = rows[0];
  return row
    ? {
        clubId: row.clubId,
        bookingId: row.id,
        currentPaymentStatus: row.paymentStatus,
        currentProviderPaymentId: row.providerPaymentId,
        bookingStatus: row.status,
        amount: row.amount,
        refundedAmountMinor: row.refundedAmountMinor,
        currency: row.currency,
      }
    : null;
}

/**
 * Audit F-20 (2026-05-07 r5): defense-in-depth check that a provider's
 * `reference` (or `provider_payment_id`) was issued by us in the last
 * 24 hours. N-Genius webhook auth is a shared-secret echo — there's no
 * body-binding. A leaked (header, body) pair lets the attacker craft
 * fresh REFUNDED / PURCHASED events for ANY reference. Pairing the
 * tightened freshness window (90 s) with this lookup adds a
 * "reference must be one we minted recently" gate so an attacker
 * needs both the secret AND a recently-issued reference to forge a
 * useful event.
 *
 * NOT load-bearing — the freshness window is the primary fix. This is
 * belt-and-braces. The query checks both `bookings.providerPaymentId`
 * (booking flow) and `liveryInvoices.providerPaymentId` (livery flow).
 * Returns true if either has a row created in the last 24h whose
 * provider_payment_id matches AND clubId matches the URL-bound club.
 */
export async function wasProviderPaymentIssuedRecently(
  providerPaymentId: string,
  provider: PaymentProvider,
  clubId: string,
  windowMs: number = 24 * 60 * 60 * 1000,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowMs);
  const bookingHit = await rawDb
    .select({ id: bookings.id })
    .from(bookings)
    .where(
      and(
        eq(bookings.providerPaymentId, providerPaymentId),
        eq(bookings.paymentProvider, provider),
        eq(bookings.clubId, clubId),
        gte(bookings.createdAt, cutoff),
      ),
    )
    .limit(1);
  if (bookingHit[0]) return true;

  const invoiceHit = await rawDb
    .select({ id: liveryInvoices.id })
    .from(liveryInvoices)
    .where(
      and(
        eq(liveryInvoices.providerPaymentId, providerPaymentId),
        eq(liveryInvoices.paymentProvider, provider),
        eq(liveryInvoices.clubId, clubId),
        gte(liveryInvoices.createdAt, cutoff),
      ),
    )
    .limit(1);
  return invoiceHit.length > 0;
}

/**
 * Audit F-22 / F-24 (2026-05-07 r5): defense-in-depth recovery path
 * for the booking-payment write race against instant-succeed Stripe /
 * Apple Pay / Ziina / N-Genius events. The route stamps
 * `[booking:UUID]` into the description at intent creation
 * (`apps/web/app/api/v1/bookings/[bookingId]/payment/route.ts:207`);
 * adapters surface that string back as `WebhookEvent.descriptionForRecovery`.
 * When neither `findBookingByProviderPaymentId` (TOCTOU race —
 * `setBookingPaymentRef` hadn't yet written) NOR
 * `findBookingByIdForWebhook` (provider doesn't carry metadata —
 * Ziina / N-Genius) resolves a booking, the helper extracts the UUID
 * from this string and looks up the booking by id within the URL-bound
 * club's tenant.
 *
 * Returns the same shape as `findBookingByIdForWebhook` — a uuid that
 * doesn't belong to this club returns null (so a description spoofed
 * by a colliding event from another tenant can't bridge tenants).
 */
const BOOKING_DESCRIPTION_MARKER_REGEX = /\[booking:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\]/;

export async function findBookingByIdInDescription(
  description: string | undefined,
  clubId: string,
): Promise<{
  clubId: string;
  bookingId: string;
  currentPaymentStatus: string;
  currentProviderPaymentId: string | null;
  bookingStatus: string;
  amount: number | null;
  refundedAmountMinor: number;
  currency: string;
} | null> {
  if (!description) return null;
  const match = BOOKING_DESCRIPTION_MARKER_REGEX.exec(description);
  if (!match) return null;
  const candidateBookingId = match[1];
  if (!candidateBookingId) return null;
  return findBookingByIdForWebhook(candidateBookingId, clubId);
}

/**
 * Webhook-only view of a payment account — the minimum needed to verify
 * an inbound webhook signature, without surfacing the provider's full
 * API key. Audit B-9: the previous webhook routes loaded the full
 * decrypted credentials blob (which includes the API key, outletId,
 * realmName) just to read one webhook secret. A future
 * `logger.error('webhook_failed', { account })` would have leaked the
 * API key into Cloudflare Logs / Sentry. By returning only the webhook
 * fields, that leak primitive is gone.
 *
 * The DB column for the webhook secret hasn't been split yet
 * (deliberate — that's a follow-up data-migration). For now the helper
 * extracts ONLY the webhook fields out of the credentials blob and
 * never returns the rest. Callers that need the API key (payment
 * route, refund route) keep using the full-credentials helpers.
 */
export interface WebhookSecretConfig {
  clubId: string;
  externalAccountId: string | null;
  status: PaymentAccountStatus;
  /** Stored under credentials.webhookSigningSecret today (Ziina). */
  webhookSigningSecret: string | null;
  /** N-Genius pair — stored under credentials.{webhookHeaderName,webhookHeaderValue}. */
  webhookHeaderName: string | null;
  webhookHeaderValue: string | null;
}

function rowToWebhookSecretConfig(row: PaymentAccountRow): WebhookSecretConfig {
  // Touch credentials in this isolated scope only; the surrounding
  // function returns a narrower object so no caller ever sees the
  // provider API key.
  let creds: Record<string, unknown> | null = null;
  if (row.encryptedCredentials) {
    const plaintext = decryptField(row.encryptedCredentials);
    if (plaintext) {
      try {
        creds = JSON.parse(plaintext) as Record<string, unknown>;
      } catch {
        creds = null;
      }
    }
  }
  // Audit AI-32a — typeof guard already narrows to string; no cast needed.
  // Hoist the values so the narrow survives optional-chain lookups.
  const signingSecret = creds?.webhookSigningSecret;
  const headerName = creds?.webhookHeaderName;
  const headerValue = creds?.webhookHeaderValue;
  return {
    clubId: row.clubId,
    externalAccountId: row.externalAccountId,
    status: row.status,
    webhookSigningSecret: typeof signingSecret === 'string' ? signingSecret : null,
    webhookHeaderName: typeof headerName === 'string' ? headerName : null,
    webhookHeaderValue: typeof headerValue === 'string' ? headerValue : null,
  };
}

/**
 * Webhook-secret-only view of `findPaymentAccountByExternalId`. Use this
 * from N-Genius / Stripe Connect webhook routes that match by
 * external account id.
 */
export async function findWebhookConfigByExternalId(
  externalAccountId: string,
  provider: PaymentProvider,
): Promise<WebhookSecretConfig | null> {
  const rows = await rawDb
    .select()
    .from(clubPaymentAccounts)
    .where(
      and(
        eq(clubPaymentAccounts.externalAccountId, externalAccountId),
        eq(clubPaymentAccounts.provider, provider),
        sql`${clubPaymentAccounts.status} != 'disabled'`,
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? rowToWebhookSecretConfig(row) : null;
}

/**
 * Webhook-secret-only view of `adminGetPaymentAccountByProvider`. Use
 * this from per-club webhook routes (Ziina) that resolve clubId from
 * the URL.
 */
export async function getWebhookConfigByClubProvider(
  clubId: string,
  provider: PaymentProvider,
): Promise<WebhookSecretConfig | null> {
  const rows = await rawDb
    .select()
    .from(clubPaymentAccounts)
    .where(
      and(
        eq(clubPaymentAccounts.clubId, clubId),
        eq(clubPaymentAccounts.provider, provider),
        sql`${clubPaymentAccounts.status} != 'disabled'`,
      ),
    )
    .limit(1);
  const row = rows[0];
  return row ? rowToWebhookSecretConfig(row) : null;
}
