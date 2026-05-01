import { eq, and, asc, desc, ne, sql, SQL } from 'drizzle-orm';
import { calculateCouponDiscount, formatMoney } from '@equestrian/shared/utils';
import { db } from '../index';
import { invoices } from '../schema/finances';
import { expenses } from '../schema/finances';
import { payments } from '../schema/finances';
import { bookings } from '../schema/bookings';
import { liveryInvoices } from '../schema/livery-invoices';
import { coupons, couponUsages } from '../schema/packages';
import { clubMembers } from '../schema/club-members';

// ─── Overview ─────────────────────────────────────────────────────────

export async function getFinanceOverview(clubId: string) {
  // Aggregate from `bookings` and `livery_invoices` — those are the tables
  // that webhook handlers + the cancel/refund route actually write to. The
  // legacy `payments` table is modelled but no code writes to it, so the
  // previous query returned 0 indefinitely (audit C-3). When we eventually
  // populate `payments` (via webhook helpers backfilling row-per-payment),
  // this can be replaced with the simpler SUM over that table.
  const [
    bookingRevenueResult,
    liveryRevenueResult,
    expenseResult,
    bookingsOutstandingResult,
    liveryOutstandingResult,
    bookingMethodBreakdown,
  ] = await Promise.all([
    db
      .select({
        total: sql<number>`coalesce(sum(${bookings.amount} - coalesce(${bookings.refundedAmountMinor}, 0)), 0)::int`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.clubId, clubId),
          sql`${bookings.paymentStatus} IN ('paid', 'partial')`,
        ),
      ),
    db
      .select({
        total: sql<number>`coalesce(sum(${liveryInvoices.amountMinorUnits}), 0)::int`,
      })
      .from(liveryInvoices)
      .where(
        and(eq(liveryInvoices.clubId, clubId), eq(liveryInvoices.status, 'paid')),
      ),
    db
      .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)::int` })
      .from(expenses)
      .where(eq(expenses.clubId, clubId)),
    db
      .select({
        total: sql<number>`coalesce(sum(${bookings.amount} - coalesce(${bookings.refundedAmountMinor}, 0)), 0)::int`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.clubId, clubId),
          sql`${bookings.paymentStatus} = 'pending'`,
          sql`${bookings.status} != 'cancelled'`,
          sql`${bookings.amount} IS NOT NULL`,
        ),
      ),
    db
      .select({
        total: sql<number>`coalesce(sum(${liveryInvoices.amountMinorUnits}), 0)::int`,
      })
      .from(liveryInvoices)
      .where(
        and(
          eq(liveryInvoices.clubId, clubId),
          sql`${liveryInvoices.status} IN ('pending', 'overdue')`,
        ),
      ),
    db
      .select({
        method: bookings.paymentMethod,
        total: sql<number>`coalesce(sum(${bookings.amount} - coalesce(${bookings.refundedAmountMinor}, 0)), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.clubId, clubId),
          sql`${bookings.paymentStatus} IN ('paid', 'partial')`,
          sql`${bookings.paymentMethod} IS NOT NULL`,
        ),
      )
      .groupBy(bookings.paymentMethod),
  ]);

  const totalRevenue =
    (bookingRevenueResult[0]?.total ?? 0) + (liveryRevenueResult[0]?.total ?? 0);
  const outstandingBalance =
    (bookingsOutstandingResult[0]?.total ?? 0) +
    (liveryOutstandingResult[0]?.total ?? 0);

  return {
    totalRevenue,
    totalExpenses: expenseResult[0]?.total ?? 0,
    outstandingBalance,
    paymentMethodBreakdown: bookingMethodBreakdown.filter((b) => b.method != null),
  };
}

// ─── Expenses ─────────────────────────────────────────────────────────

type NewExpense = typeof expenses.$inferInsert;
type ExpenseCreate = Omit<NewExpense, 'id' | 'clubId' | 'createdAt' | 'updatedAt' | 'createdByMemberId'>;

interface ExpenseFilters {
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}

export async function getExpensesByClub(clubId: string, filters: ExpenseFilters) {
  const conditions: SQL[] = [eq(expenses.clubId, clubId)];

  if (filters.category) {
    conditions.push(sql`${expenses.category} = ${filters.category}`);
  }
  if (filters.dateFrom) {
    conditions.push(sql`${expenses.date} >= ${filters.dateFrom}`);
  }
  if (filters.dateTo) {
    conditions.push(sql`${expenses.date} <= ${filters.dateTo}`);
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  const [data, countResult] = await Promise.all([
    db.select().from(expenses).where(where).orderBy(desc(expenses.date)).limit(filters.pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(expenses).where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}

export async function getExpenseById(clubId: string, expenseId: string) {
  const result = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.clubId, clubId)))
    .limit(1);
  return result[0] ?? null;
}

export async function createExpense(clubId: string, data: ExpenseCreate, memberId?: string) {
  const result = await db.insert(expenses).values({
    ...data,
    clubId,
    createdByMemberId: memberId ?? null,
  }).returning();
  return result[0];
}

export async function updateExpense(
  clubId: string,
  expenseId: string,
  data: Partial<ExpenseCreate>,
) {
  const result = await db
    .update(expenses)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(expenses.id, expenseId), eq(expenses.clubId, clubId)))
    .returning();
  return result[0] ?? null;
}

export async function deleteExpense(clubId: string, expenseId: string) {
  const result = await db.delete(expenses).where(and(eq(expenses.id, expenseId), eq(expenses.clubId, clubId))).returning({ id: expenses.id });
  return result[0] ?? null;
}

// ─── Payments ─────────────────────────────────────────────────────────

interface PaymentFilters {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}

export async function getPaymentsByClub(clubId: string, filters: PaymentFilters) {
  const conditions: SQL[] = [eq(payments.clubId, clubId)];

  if (filters.status) {
    conditions.push(sql`${payments.status} = ${filters.status}`);
  }
  if (filters.dateFrom) {
    conditions.push(sql`${payments.paidAt} >= ${filters.dateFrom}`);
  }
  if (filters.dateTo) {
    conditions.push(sql`${payments.paidAt} <= ${filters.dateTo}`);
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  const [data, countResult] = await Promise.all([
    db
      .select({
        id: payments.id,
        amount: payments.amount,
        currency: payments.currency,
        paymentMethod: payments.paymentMethod,
        status: payments.status,
        description: payments.description,
        paidAt: payments.paidAt,
        createdAt: payments.createdAt,
        memberName: clubMembers.displayName,
      })
      .from(payments)
      // Bind the join to `clubId` as well as `memberId`. The FK on
      // `payments.member_id` is single-column, so without this a row pointing
      // at a foreign tenant's member (planted by an unrelated bug) would
      // surface that tenant's `displayName`. Migration 0019 closes this at
      // the schema level via composite FK; the join binding is defence in depth.
      .innerJoin(
        clubMembers,
        and(eq(payments.memberId, clubMembers.id), eq(clubMembers.clubId, clubId)),
      )
      .where(where)
      .orderBy(desc(payments.createdAt))
      .limit(filters.pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(payments).where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}

// ─── Coupons ──────────────────────────────────────────────────────────

interface CouponFilters {
  status?: string;
  page: number;
  pageSize: number;
}

export async function getCouponsByClub(clubId: string, filters: CouponFilters) {
  const conditions: SQL[] = [eq(coupons.clubId, clubId)];

  if (filters.status) {
    conditions.push(sql`${coupons.status} = ${filters.status}`);
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  const [data, countResult] = await Promise.all([
    db.select().from(coupons).where(where).orderBy(desc(coupons.createdAt)).limit(filters.pageSize).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(coupons).where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}

type NewCoupon = typeof coupons.$inferInsert;
type CouponCreate = Omit<NewCoupon, 'id' | 'clubId' | 'createdAt' | 'updatedAt' | 'usageCount' | 'createdByMemberId'>;

export async function createCoupon(clubId: string, data: CouponCreate, memberId?: string) {
  const result = await db.insert(coupons).values({
    ...data,
    clubId,
    createdByMemberId: memberId ?? null,
  }).returning();
  return result[0];
}

export async function updateCoupon(clubId: string, couponId: string, data: Partial<CouponCreate>) {
  const result = await db
    .update(coupons)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(coupons.id, couponId), eq(coupons.clubId, clubId)))
    .returning();
  return result[0] ?? null;
}

export async function getCouponByCode(clubId: string, code: string) {
  const result = await db
    .select()
    .from(coupons)
    .where(
      and(
        eq(coupons.clubId, clubId),
        sql`UPPER(${coupons.code}) = UPPER(${code})`,
      ),
    )
    .limit(1);
  return result[0] ?? null;
}

interface ValidateCouponParams {
  clubId: string;
  code: string;
  amount: number;
  /** Required for the minimum-spend message — currency-aware formatting
   * (KWD has 3 decimals, JPY has 0). Defaults to AED when omitted so the
   * legacy callers stay correct for the dominant tenant. Audit AI-21. */
  currency?: string;
  riderMemberId: string;
  lessonType?: string;
}

export async function validateCoupon(params: ValidateCouponParams): Promise<{
  valid: boolean;
  discount: number;
  couponId?: string;
  error?: string;
}> {
  const coupon = await getCouponByCode(params.clubId, params.code);

  if (!coupon) {
    return { valid: false, discount: 0, error: 'Invalid promo code' };
  }

  if (coupon.status !== 'active') {
    return { valid: false, discount: 0, error: 'This promo code is no longer active' };
  }

  if (coupon.expiresAt && new Date() > coupon.expiresAt) {
    return { valid: false, discount: 0, error: 'This promo code has expired' };
  }

  if (coupon.startsAt && new Date() < coupon.startsAt) {
    return { valid: false, discount: 0, error: 'This promo code is not yet active' };
  }

  if (coupon.maxUses && coupon.usageCount >= coupon.maxUses) {
    return { valid: false, discount: 0, error: 'This promo code has reached its maximum uses' };
  }

  if (coupon.maxUsesPerRider) {
    const riderUsage = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(couponUsages)
      .where(
        and(
          // Belt-and-braces tenant scope. `couponId` is already club-scoped
          // today, so this is redundant — but a future cross-club coupon
          // link would silently leak per-rider counts across tenants
          // without it.
          eq(couponUsages.clubId, params.clubId),
          eq(couponUsages.couponId, coupon.id),
          eq(couponUsages.riderMemberId, params.riderMemberId),
        ),
      );
    if ((riderUsage[0]?.count ?? 0) >= coupon.maxUsesPerRider) {
      return { valid: false, discount: 0, error: 'You have already used this promo code' };
    }
  }

  if (coupon.minimumAmount != null && params.amount < coupon.minimumAmount) {
    // Currency-aware formatting (audit AI-21). The previous /100 .toFixed(2)
    // was wrong by 10× for KWD/BHD (3-decimal) and 100× for JPY (0-decimal)
    // and never showed the currency code.
    return {
      valid: false,
      discount: 0,
      error: `Minimum spend of ${formatMoney(coupon.minimumAmount, params.currency ?? 'AED')} required`,
    };
  }

  // Audit H-4: enforce coupon.firstTimeOnly. Coupon admins set this on
  // promo codes restricted to new riders; without enforcement here, every
  // returning rider with the code can use it. "First-time" = the rider has
  // no non-cancelled bookings prior to this attempt.
  if (coupon.firstTimeOnly) {
    const priorBookings = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.clubId, params.clubId),
          eq(bookings.riderMemberId, params.riderMemberId),
          ne(bookings.status, 'cancelled'),
        ),
      )
      .limit(1);
    if (priorBookings.length > 0) {
      return {
        valid: false,
        discount: 0,
        error: 'This promo is for first-time riders only',
      };
    }
  }

  // Audit H-4: enforce coupon.applicableTypes. When the admin restricts a
  // promo to specific lesson-type slugs (e.g. ['dressage', 'jumping']),
  // reject it on bookings against any other type. `lessonType` is passed
  // by the booking creation path; legacy callers that omit it skip this
  // gate (preserves backwards-compat with the API contract).
  if (
    coupon.applicableTypes &&
    coupon.applicableTypes.length > 0 &&
    params.lessonType &&
    !coupon.applicableTypes.includes(params.lessonType)
  ) {
    return {
      valid: false,
      discount: 0,
      error: 'This promo code is not valid for this lesson type',
    };
  }

  // Single source of truth for the math (audit AI-9). The shared helper
  // also enforces the order-total cap so a percentage coupon can never
  // refund more than was charged.
  const discount = calculateCouponDiscount({
    amount: params.amount,
    discountType: coupon.discountType as 'percentage' | 'fixed',
    discountValue: coupon.discountValue,
    maxDiscount: coupon.maxDiscount,
  });

  return { valid: true, discount, couponId: coupon.id };
}

// ─── Invoices ─────────────────────────────────────────────────────────

interface InvoiceFilters {
  status?: string;
  page: number;
  pageSize: number;
}

export async function getInvoicesByClub(clubId: string, filters: InvoiceFilters) {
  const conditions: SQL[] = [eq(invoices.clubId, clubId)];

  if (filters.status) {
    conditions.push(sql`${invoices.status} = ${filters.status}`);
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  const [data, countResult] = await Promise.all([
    db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        status: invoices.status,
        amount: invoices.amount,
        totalAmount: invoices.totalAmount,
        currency: invoices.currency,
        description: invoices.description,
        dueDate: invoices.dueDate,
        paidAt: invoices.paidAt,
        sentAt: invoices.sentAt,
        createdAt: invoices.createdAt,
        memberName: clubMembers.displayName,
      })
      .from(invoices)
      // Same defence-in-depth tenant binding as `getPaymentsByClub` above.
      .innerJoin(
        clubMembers,
        and(eq(invoices.memberId, clubMembers.id), eq(clubMembers.clubId, clubId)),
      )
      .where(where)
      .orderBy(desc(invoices.createdAt))
      .limit(filters.pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(invoices).where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}
