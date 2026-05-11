import {
  pgTable,
  uuid,
  varchar,
  integer,
  timestamp,
  date,
  text,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { liveryInvoiceStatusEnum, subscriptionTierEnum } from './enums';
import { clubs } from './clubs';

/**
 * Cavaliq → club subscription invoices. Round 6 platform billing — these
 * are the bills Cavaliq sends to clubs for their monthly SaaS subscription
 * (Starter / Growing / Professional). Distinct from `livery_invoices`,
 * which are bills clubs send to horse owners.
 *
 * The status enum is shared with livery (pending / paid / overdue /
 * cancelled) — same lifecycle, no need for a parallel enum.
 *
 * Tier and amount are snapshotted at issue time so a tier change
 * mid-cycle doesn't retroactively alter past invoices' totals.
 *
 * Uniqueness on (club_id, period_start) makes the daily cron idempotent
 * — running twice on the same day for the same club is a no-op.
 */
export const platformSubscriptionInvoices = pgTable(
  'platform_subscription_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),

    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),

    // Snapshot at issue time. A future tier upgrade/downgrade applies to
    // the next period; what was billed for THIS period stays as-billed.
    tier: subscriptionTierEnum('tier').notNull(),
    amountMinorUnits: integer('amount_minor_units').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('AED'),

    periodStart: date('period_start').notNull(),
    // Inclusive last day of the billed month. Same convention as livery.
    periodEnd: date('period_end').notNull(),

    status: liveryInvoiceStatusEnum('status').notNull().default('pending'),
    dueDate: date('due_date').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

    // Always 'ziina' for now — Cavaliq's platform Ziina account is the
    // sole receiver. Kept as varchar for future expansion (e.g. Stripe
    // platform billing once the trade license shape allows it).
    paymentProvider: varchar('payment_provider', { length: 50 }),
    providerPaymentId: varchar('provider_payment_id', { length: 255 }),
    payLink: text('pay_link'),

    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    reminderCount: integer('reminder_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One invoice per club per billing period — concurrent cron passes
    // can race here; createPlatformInvoiceWithGeneratedNumber's
    // onConflictDoNothing returns null on the loser, which the caller
    // treats as "already issued" and increments the skipped counter.
    unique('platform_subscription_invoices_unique_club_period').on(table.clubId, table.periodStart),
    // Per-club unique invoice number — same pattern as
    // livery_invoices_club_number_unique. The 23505 retry loop in
    // createPlatformInvoiceWithGeneratedNumber lives behind this.
    unique('platform_subscription_invoices_club_number_unique').on(
      table.clubId,
      table.invoiceNumber,
    ),
    index('idx_platform_invoices_club').on(table.clubId),
    index('idx_platform_invoices_status_due').on(table.status, table.dueDate),
    index('idx_platform_invoices_provider_payment').on(table.providerPaymentId),
  ],
);
