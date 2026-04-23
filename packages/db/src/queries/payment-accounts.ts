import { eq, and, asc } from 'drizzle-orm';
import { db, rawDb, writeTransaction } from '../index';
import { clubPaymentAccounts } from '../schema/finances';
import { bookings } from '../schema/bookings';
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
    return { ...summary, credentials: null };
  }
  try {
    return { ...summary, credentials: JSON.parse(plaintext) as DecryptedCredentials };
  } catch {
    return { ...summary, credentials: null };
  }
}

/** Lists every payment account for a club — for settings / connected-accounts UI. */
export async function listPaymentAccounts(clubId: string): Promise<PaymentAccountSummary[]> {
  const rows = await db
    .select()
    .from(clubPaymentAccounts)
    .where(eq(clubPaymentAccounts.clubId, clubId))
    .orderBy(asc(clubPaymentAccounts.provider));

  return rows.map(toSummary);
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
 */
export async function findBookingByProviderPaymentId(
  providerPaymentId: string,
  provider: PaymentProvider,
): Promise<{ clubId: string; bookingId: string; currentPaymentStatus: string } | null> {
  const rows = await rawDb
    .select({
      id: bookings.id,
      clubId: bookings.clubId,
      paymentStatus: bookings.paymentStatus,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.providerPaymentId, providerPaymentId),
        eq(bookings.paymentProvider, provider),
      ),
    )
    .limit(1);

  const row = rows[0];
  return row
    ? { clubId: row.clubId, bookingId: row.id, currentPaymentStatus: row.paymentStatus }
    : null;
}
