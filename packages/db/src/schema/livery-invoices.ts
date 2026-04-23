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
    horseId: uuid('horse_id')
      .notNull()
      .references(() => horses.id, { onDelete: 'cascade' }),
    ownerMemberId: uuid('owner_member_id')
      .notNull()
      .references(() => clubMembers.id),

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
    payLink: text('pay_link'),

    lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
    reminderCount: integer('reminder_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('livery_invoices_unique_horse_period').on(table.horseId, table.periodStart),
    index('idx_livery_invoices_club').on(table.clubId),
    index('idx_livery_invoices_owner_status').on(table.ownerMemberId, table.status),
    index('idx_livery_invoices_horse').on(table.horseId),
    index('idx_livery_invoices_status_due').on(table.status, table.dueDate),
    index('idx_livery_invoices_provider_payment').on(table.providerPaymentId),
  ],
);
