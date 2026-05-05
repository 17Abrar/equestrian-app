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
} from 'drizzle-orm/pg-core';
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
export const clubPaymentAccounts = pgTable('club_payment_accounts', {
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
}, (table) => [
  unique('club_payment_accounts_club_provider_unique').on(table.clubId, table.provider),
  index('idx_payment_accounts_club').on(table.clubId),
  index('idx_payment_accounts_active').on(table.clubId, table.isActive),
]);

export const liveryContracts = pgTable('livery_contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),
  ownerMemberId: uuid('owner_member_id')
    .notNull()
    .references(() => clubMembers.id),
  horseId: uuid('horse_id')
    .notNull()
    .references(() => horses.id),

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
}, (table) => [
  index('idx_livery_club').on(table.clubId),
  index('idx_livery_owner').on(table.ownerMemberId),
  index('idx_livery_horse').on(table.horseId),
]);

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

    liveryContractId: uuid('livery_contract_id').references(() => liveryContracts.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('invoices_club_number_unique').on(table.clubId, table.invoiceNumber),
    index('idx_invoices_club').on(table.clubId),
    index('idx_invoices_member').on(table.memberId),
    index('idx_invoices_status').on(table.clubId, table.status),
    foreignKey({
      name: 'invoices_member_club_fk',
      columns: [table.memberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }),
  ],
);

export const payments = pgTable('payments', {
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
  // FK to `rider_packages.id` ON DELETE SET NULL added in migration
  // 0035 (audit pass-2 schema-drift sweep). Previously a bare UUID,
  // permitting cross-tenant smuggling of arbitrary rider-package IDs.
  packageId: uuid('package_id').references(() => riderPackages.id, {
    onDelete: 'set null',
  }),
  liveryContractId: uuid('livery_contract_id').references(() => liveryContracts.id),
  invoiceId: uuid('invoice_id').references(() => invoices.id),

  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
  stripeChargeId: varchar('stripe_charge_id', { length: 255 }),

  refundedAmount: integer('refunded_amount').default(0),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),

  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
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
]);

export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  clubId: uuid('club_id')
    .notNull()
    .references(() => clubs.id, { onDelete: 'cascade' }),

  category: varchar('category', { length: 100 }).notNull(),
  description: text('description').notNull(),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('AED'),
  date: date('date').notNull(),
  horseId: uuid('horse_id').references(() => horses.id),
  receiptUrl: text('receipt_url'),
  vendorName: varchar('vendor_name', { length: 255 }),

  createdByMemberId: uuid('created_by_member_id').references(() => clubMembers.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_expenses_club').on(table.clubId),
  index('idx_expenses_date').on(table.clubId, table.date),
  index('idx_expenses_horse').on(table.horseId),
  index('idx_expenses_category').on(table.clubId, table.category),
]);
