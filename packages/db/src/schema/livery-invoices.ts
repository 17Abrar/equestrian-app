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
  foreignKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { liveryInvoiceStatusEnum } from './enums';
import { clubs } from './clubs';
import { horses } from './horses';
import { clubMembers } from './club-members';

export const liveryInvoices = pgTable(
  'livery_invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'cascade' }),
    // Audit MED (2026-05-06 third pass): the inline single-column FKs
    // were dropped in migration 0038 and replaced with composites
    // declared in the table-extras below. Ensures that a future writer
    // bypassing the route-level precheck cannot insert a row whose
    // (horse_id, club_id) pair points at a horse in another club.
    horseId: uuid('horse_id').notNull(),
    ownerMemberId: uuid('owner_member_id').notNull(),

    invoiceNumber: varchar('invoice_number', { length: 50 }).notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    amountMinorUnits: integer('amount_minor_units').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('AED'),

    status: liveryInvoiceStatusEnum('status').notNull().default('pending'),
    dueDate: date('due_date').notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

    paymentProvider: varchar('payment_provider', { length: 50 }),
    providerPaymentId: varchar('provider_payment_id', { length: 255 }),
    // Audit I1 (2026-05-18): mirror of `bookings.providerPaymentIssuedAt`
    // for livery invoices. Stamped by `setInvoiceProviderRef` every
    // time `providerPaymentId` is set / replaced; read by
    // `wasProviderPaymentIssuedRecently` so the N-Genius freshness
    // gate keys on pay-link issuance time rather than invoice
    // creation time.
    providerPaymentIssuedAt: timestamp('provider_payment_issued_at', { withTimezone: true }),
    payLink: text('pay_link'),

    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    reminderCount: integer('reminder_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Audit QA-22 pass-2: the global `unique('livery_invoices_unique_horse_period')`
    // declaration was dropped in migration 0027, replaced with a partial
    // unique `WHERE status <> 'cancelled'` so a cancelled invoice for
    // (horse, period) doesn't block re-issuing one for the same period
    // (the cancel-then-reissue admin flow). Drizzle has no partial-unique
    // builder; the constraint lives at the SQL layer only and does NOT
    // appear here. Keep this comment so a future schema reviewer
    // doesn't re-add the global form.
    index('idx_livery_invoices_club').on(table.clubId),
    index('idx_livery_invoices_owner_status').on(table.ownerMemberId, table.status),
    index('idx_livery_invoices_horse').on(table.horseId),
    // Audit F-13 (2026-05-07 r5): both indexes are PARTIAL in SQL (migration
    // 0010:48-58). Without `.where(...)` here, `drizzle-kit generate` would
    // emit DROP+CREATE-as-full migrations and silently strip the predicates,
    // leading to 5-10× index storage growth and slower
    // `findOverdueInvoicesForReminders` cron passes.
    index('idx_livery_invoices_status_due')
      .on(table.status, table.dueDate)
      .where(sql`status IN ('pending', 'overdue')`),
    index('idx_livery_invoices_provider_payment')
      .on(table.providerPaymentId)
      .where(sql`provider_payment_id IS NOT NULL`),
    // Audit F-14 (2026-05-07 r5): unique on `(club_id, invoice_number)`
    // declared by migration 0022. The runtime depends on this — the 23505
    // retry loop in `createLiveryInvoiceWithGeneratedNumber` catches this
    // exact constraint name. A `db:push` against TS-only schema would
    // create a DB without it, allowing concurrent crons to mint dup
    // invoice numbers. Mirrors `platform_subscription_invoices_club_number_unique`.
    unique('livery_invoices_club_number_unique').on(table.clubId, table.invoiceNumber),
    foreignKey({
      name: 'livery_invoices_horse_club_fk',
      columns: [table.horseId, table.clubId],
      foreignColumns: [horses.id, horses.clubId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'livery_invoices_owner_member_club_fk',
      columns: [table.ownerMemberId, table.clubId],
      foreignColumns: [clubMembers.id, clubMembers.clubId],
    }),
    // ON DELETE NO ACTION on owner_member: invoices are financial
    // records that should outlive the member's row; finance reports
    // query historical invoices by owner_member_id even after the
    // member departs.
    // Audit F-11 (2026-05-07 r4): SQL CHECK from migration 0025 —
    // schema drift fix.
    check('livery_invoices_period_range_check', sql`${table.periodStart} <= ${table.periodEnd}`),
  ],
);
