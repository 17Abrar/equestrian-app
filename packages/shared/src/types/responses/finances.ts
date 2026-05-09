/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated finance response DTOs.
 * Source-of-truth projections live in `packages/db/src/queries/finances.ts`.
 */

import type {
  CouponDiscountType,
  CouponStatus,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
} from '../index';

/**
 * Audit pass-3 follow-up D (2026-05-09): per-currency totals. The
 * dashboard renders one card-group per currency so a club operating
 * in two currencies can see each side without the SUMs adding apples
 * to oranges. Single-currency clubs get exactly one entry and the UI
 * reads identical to the pre-D dashboard.
 */
export interface CurrencyTotals {
  currency: string;
  totalRevenue: number;
  totalExpenses: number;
  outstandingBalance: number;
}

export interface FinanceOverview {
  totalsByCurrency: CurrencyTotals[];
  paymentMethodBreakdown: Array<{
    method: string;
    currency: string;
    total: number;
    count: number;
  }>;
}

export interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  horseId: string | null;
  vendorName: string | null;
}

export interface Payment {
  id: string;
  amount: number;
  currency: string;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  description: string | null;
  paidAt: string | null;
  createdAt: string;
  memberName: string | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  amount: number;
  totalAmount: number;
  currency: string;
  description: string | null;
  dueDate: string | null;
  paidAt: string | null;
  sentAt: string | null;
  createdAt: string;
  memberName: string | null;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  maxDiscount: number | null;
  maxUses: number | null;
  maxUsesPerRider: number | null;
  usageCount: number;
  status: CouponStatus;
  startsAt: string | null;
  expiresAt: string | null;
}
