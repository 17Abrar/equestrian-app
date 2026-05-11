import {
  pgTable,
  uuid,
  varchar,
  text,
  date,
  integer,
  boolean,
  timestamp,
  jsonb,
  unique,
  index,
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  liveryTypeEnum,
  paymentMethodEnum,
  paymentStatusEnum,
  invoiceStatusEnum,
  paymentProviderEnum,
  paymentAccountStatusEnum,
} from './enums';
import { clubs } from './clubs';
import { clubMembers } from './club-members';
import { horses } from './horses';

// Audit AI-43 — typed jsonb shapes for the finance tables.
/** A single line on an issued invoice. Quantity defaults to 1 if omitted
 *  by the issuer; unit/total amounts are minor units to match the parent
 *  invoice's `amount`. */
export interface InvoiceLineItem {
  description: string;
  quantity?: number;
  /** Per-unit price in minor currency units. */
  unitAmount: number;
  /** Total for this line in minor currency units (quantity × unitAmount). */
  totalAmount: number;
}
/** Free-form payment metadata stamped by the adapter (provider session id,
 *  refund reason, etc.). `Record<string, JsonValue>` would over-tighten —
 *  every adapter records different keys. */
export type PaymentMetadata = Record<string, unknown>;
import { bookings } from './bookings';
import { riderPackages } from './packages';

/**
 * One row per (club, provider). A club may have multiple provider rows but
 * exactly one with `is_active = true` at any time. The `tenant_isolation`
 * RLS policy restricts rows by `club_id` like every other tenant table.
 *
 * `encrypted_credentials` stores the libsodium-encrypted API secret for
 * providers that use static keys (N-Genius, Ziina). Stripe Connect uses
 * OAuth — we only keep `external_account_id` (the connected account id).
 */
export const clubPaymentAccounts = pgTable(
  'club_payment_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),

    provider: paymentProviderEnum('provider').notNull(),
    status: paymentAccountStatusEnum('status').notNull().default('pending'),
    isActive: boolean('is_active').notNull().default(false),

    // Provider's identifier for the merchant: Stripe `acct_...`, N-Genius
    // outletReference, Ziina account id.
    externalAccountId: varchar('external_account_id', { length: 255 }),

    // Encrypted with AES-256-GCM via `encryptField`. Null for providers that
    // don't need stored credentials (Stripe Standard Connect).
    encryptedCredentials: text('encrypted_credentials'),

    // Audit F-33 (2026-05-08 r6): SHA-256 hex digest of the webhook
    // signing secret pasted by the operator at connect time. Cleartext
    // is fine — a hash can't be reversed to the secret. The partial
    // UNIQUE index `club_payment_accounts_webhook_secret_hash_unique`
    // (migration 0051 — was 0048 before the journal-orphan fix in PR
    // #84 renamed it) enforces "no two clubs use the same webhook
    // secret" so a copy-paste mistake (one operator configuring two
    // clubs in one Stripe dashboard with the same `whsec_…`) is
    // rejected at connect time instead of failing-closed silently in
    // every downstream webhook delivery. NULL when the operator opted
    // out of webhook delivery.
    webhookSecretHash: varchar('webhook_secret_hash', { length: 64 }),

    // Provider-specific metadata: display name, currency support, capabilities,
    // charges_enabled flag, webhook endpoint URL, etc. Never store secrets here.
    // Intentionally untyped — each provider records different keys; consumers
    // narrow at read time using the `provider` discriminator.
    metadata: jsonb('metadata'),

    // Most recent error surfaced during a payment or webhook, for UI display.
    lastError: text('last_error'),

    connectedAt: timestamp('connected_at', { withTimezone: true }),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('club_payment_accounts_club_provider_unique').on(table.clubId, table.provider),
    index('idx_payment_accounts_club').on(table.clubId),
    index('idx_payment_accounts_active').on(table.clubId, table.isActive),
    // Audit F-11 (2026-05-07 r4): partial UNIQUE
    // `idx_payment_accounts_one_active_per_club` (migration 0028 line
    // 19) enforces "at most one provider per club marked active at a
    // time". Drizzle has no partial-unique builder; the constraint
    // lives at the SQL layer only and does NOT appear here. Keep this
    // comment so a future schema reviewer doesn't add the global form.
    //
    // Audit F-6 (2026-05-08 r6): partial UNIQUE
    // `idx_payment_accounts_n_genius_outlet_unique` (migration 0050)
    // on `(provider, external_account_id)` WHERE
    // `provider = 'n_genius' AND status <> 'disabled'`. Closes the
    // cross-tenant routing surface where two clubs sharing an outletId
    // would silently bind webhooks to the first row Drizzle returns.
    // Stripe + Ziina avoid this by URL-binding the clubId; N-Genius
    // alone trusts the body. Drizzle has no partial-unique builder,
    // so this lives at the SQL layer.
  ],
);

/**
 * Audit pass-2 (2026-05-09 D-1): burned (retired) webhook-secret
 * hashes. The F-33 partial UNIQUE on `club_payment_accounts.webhook_
 * secret_hash` enforces "no two CURRENTLY-CONNECTED clubs share the
 * same secret hash". When a club disconnects (or rotates to a fresh
 * secret), their old hash leaves the live table and the F-33 check
 * stops covering it. Without this companion table, a club could
 * paste a different club's old secret post-disconnect and start
 * receiving webhooks signed with that secret.
 *
 * Rows here are 64-character SHA-256 hex digests; cheap to keep
 * indefinitely. `(provider, secret_hash)` is unique — once a hash
 * is burned, re-burning is a no-op.
 *
 * `clubId` records WHICH club previously held the hash for forensic
 * traceability. ON DELETE SET NULL so the burn record survives a
 * club soft-delete (the hash should stay burned even if the club
 * row goes away).
 *
 * Migration 0054 creates the table.
 */
export const burnedWebhookSecretHashes = pgTable(
  'burned_webhook_secret_hashes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: paymentProviderEnum('provider').notNull(),
    secretHash: varchar('secret_hash', { length: 64 }).notNull(),
    clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'set null' }),
    retiredAt: timestamp('retired_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('burned_webhook_secret_hashes_provider_hash_unique').on(
      table.provider,
      table.secretHash,
    ),
    index('idx_burned_webhook_secret_hashes_lookup').on(table.provider, table.secretHash),
  ],
);

export const liveryContracts = pgTable(
  'livery_contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    // Audit MED (2026-05-06 third pass — adjacent-table follow-up):
    // inline single-column FKs were dropped in migration 0039 and
    // replaced with composite (col, club_id) → club_members(id, club_id)
    // / horses(id, club_id) FKs declared in the table-extras below.
    // Same defense-in-depth pattern as 0017 / 0019 / 0038.
    ownerMemberId: uuid('owner_member_id').notNull(),
    horseId: uuid('horse_id').notNull(),

    liveryType: liveryTypeEnum('livery_type').notNull(),
    monthlyCost: integer('monthly_cost').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('AED'),
    inclusions: text('inclusions').array(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_livery_club').on(table.clubId),
    index('idx_livery_owner').on(table.ownerMemberId),
    index('idx_livery_horse').on(table.horseId),
    // FK target for composite (livery_contract_id, club_id) →
    // livery_contracts(id, club_id) on invoices and payments. Migration 0040.
    unique('livery_contracts_id_club_unique').on(table.id, table.clubId),
    // ON DELETE NO ACTION (no clause) on both composites — contracts
    // are legal agreements; deleting the horse or the owner-member
    // should require operators to deliberately end the contract first
    // rather than silently cascading. Migration 0039.
    foreignKey({
      name: 'livery_contracts_horse_club_fk',
      columns: [table.horseId, table.clubId],
      foreignColumns: [horses.id, horses.clubId],
    }),
    foreignKey({
      name: 'livery_contracts_owner_member_club_fk',
      columns: [table.ownerMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    // FK is composite (member_id, club_id) -> club_members(id, club_id),
    // declared in the table extras below. See migration 0019.
    memberId: uuid('member_id').notNull(),

    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
    status: invoiceStatusEnum('status').notNull().default('draft'),
    amount: integer('amount').notNull(),
    taxAmount: integer('tax_amount').notNull().default(0),
    totalAmount: integer('total_amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('AED'),
    description: text('description'),
    // Audit AI-43 — typed jsonb. Default `'[]'` stays as a stringified
    // empty array because Drizzle's default-marker is the SQL literal,
    // not the parsed value.
    lineItems: jsonb('line_items').$type<InvoiceLineItem[]>().notNull().default([]),
    dueDate: date('due_date'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    pdfUrl: text('pdf_url'),

    // Audit F-8 (2026-05-06 comprehensive): single-column FK dropped in
    // migration 0040; replaced with composite below.
    liveryContractId: uuid('livery_contract_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('invoices_club_number_unique').on(table.clubId, table.invoiceNumber),
    index('idx_invoices_club').on(table.clubId),
    index('idx_invoices_member').on(table.memberId),
    index('idx_invoices_status').on(table.clubId, table.status),
    // FK target for composite (invoice_id, club_id) → invoices(id, club_id)
    // on payments. Migration 0040.
    unique('invoices_id_club_unique').on(table.id, table.clubId),
    foreignKey({
      name: 'invoices_member_club_fk',
      columns: [table.memberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }),
    foreignKey({
      name: 'invoices_livery_contract_club_fk',
      columns: [table.liveryContractId, table.clubId],
      foreignColumns: [liveryContracts.id, liveryContracts.clubId],
    }),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    // FK is composite (member_id, club_id) -> club_members(id, club_id),
    // declared in the table extras below. See migration 0019.
    memberId: uuid('member_id').notNull(),

    amount: integer('amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('AED'),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    status: paymentStatusEnum('status').notNull().default('pending'),
    description: text('description'),

    // FK is composite (booking_id, club_id) -> bookings(id, club_id) ON
    // DELETE SET NULL, declared in the table extras below as
    // `payments_booking_club_fk` (matches migration 0033). The previous
    // single-column inline `references(() => bookings.id)` was a
    // residual that drizzle-kit would have regenerated as a regression.
    bookingId: uuid('booking_id'),
    // Audit F-5 (2026-05-06 r3): the prior comment claimed migration
    // 0035 had closed the cross-tenant smuggling gap on this column.
    // It hadn't — 0035 only added a SINGLE-COLUMN FK, while every
    // sibling tenant-scoped FK on this table (memberId, bookingId,
    // liveryContractId, invoiceId) was promoted to a composite. The
    // misleading "this is fixed" comment was its own hazard. Migration
    // 0043 finally promotes this to the composite (package_id, club_id)
    // → rider_packages(id, club_id) ON DELETE SET NULL declared in
    // the table-extras below.
    packageId: uuid('package_id'),
    // Audit F-12 (2026-05-06 comprehensive): single-column FKs dropped in
    // migration 0040; replaced with composites in table-extras below.
    // ON DELETE SET NULL preserves the payment row when the parent
    // livery contract or invoice is deleted (financial record).
    liveryContractId: uuid('livery_contract_id'),
    invoiceId: uuid('invoice_id'),

    stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
    stripeChargeId: varchar('stripe_charge_id', { length: 255 }),

    refundedAmount: integer('refunded_amount').default(0),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),

    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_payments_club').on(table.clubId),
    index('idx_payments_member').on(table.memberId),
    index('idx_payments_status').on(table.clubId, table.status),
    index('idx_payments_stripe').on(table.stripePaymentIntentId),
    index('idx_payments_date').on(table.clubId, table.paidAt),
    foreignKey({
      name: 'payments_member_club_fk',
      columns: [table.memberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }),
    // Composite FK ensures `bookingId` matches the payment's `clubId` —
    // closes the cross-tenant child-row planting surface a single-column
    // FK leaves open. ON DELETE SET NULL because some payments are for
    // livery invoices (booking_id NULL by design). Matches migration 0033.
    foreignKey({
      name: 'payments_booking_club_fk',
      columns: [table.bookingId, table.clubId],
      foreignColumns: [bookings.id, bookings.clubId],
    }).onDelete('set null'),
    foreignKey({
      name: 'payments_livery_contract_club_fk',
      columns: [table.liveryContractId, table.clubId],
      foreignColumns: [liveryContracts.id, liveryContracts.clubId],
    }).onDelete('set null'),
    foreignKey({
      name: 'payments_invoice_club_fk',
      columns: [table.invoiceId, table.clubId],
      foreignColumns: [invoices.id, invoices.clubId],
    }).onDelete('set null'),
    // Audit F-5 (2026-05-06 r3): composite (package_id, club_id) →
    // rider_packages(id, club_id) ON DELETE SET NULL. Migration 0043.
    foreignKey({
      name: 'payments_package_club_fk',
      columns: [table.packageId, table.clubId],
      foreignColumns: [riderPackages.id, riderPackages.clubId],
    }).onDelete('set null'),
    // Audit F-11 (2026-05-07 r4): SQL CHECK from migration 0025 — schema
    // drift fix. Refunded total cannot exceed payment amount.
    check(
      'payments_refund_le_amount_check',
      sql`COALESCE(${table.refundedAmount}, 0) >= 0 AND COALESCE(${table.refundedAmount}, 0) <= ${table.amount}`,
    ),
  ],
);

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),

    category: varchar('category', { length: 100 }).notNull(),
    description: text('description').notNull(),
    amount: integer('amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('AED'),
    date: date('date').notNull(),
    // Audit MED (2026-05-06 third pass): inline single-column FK was
    // dropped in migration 0038 and replaced with the composite
    // (horse_id, club_id) → horses(id, club_id) ON DELETE SET NULL
    // declared in the table-extras below. SET NULL keeps the expense
    // as an unattributed club-level cost when the horse it referenced
    // is deleted.
    horseId: uuid('horse_id'),
    receiptUrl: text('receipt_url'),
    vendorName: varchar('vendor_name', { length: 255 }),

    // Audit F-8 (2026-05-06 comprehensive): single-column FK dropped in
    // migration 0040; replaced with composite below preserving SET NULL.
    createdByMemberId: uuid('created_by_member_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_expenses_club').on(table.clubId),
    index('idx_expenses_date').on(table.clubId, table.date),
    index('idx_expenses_horse').on(table.horseId),
    index('idx_expenses_category').on(table.clubId, table.category),
    foreignKey({
      name: 'expenses_horse_club_fk',
      columns: [table.horseId, table.clubId],
      foreignColumns: [horses.id, horses.clubId],
    }).onDelete('set null'),
    foreignKey({
      name: 'expenses_created_by_member_club_fk',
      columns: [table.createdByMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }).onDelete('set null'),
  ],
);
