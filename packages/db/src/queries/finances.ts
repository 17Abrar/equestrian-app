import { eq, and, asc, desc, sql, SQL } from 'drizzle-orm';
import { db } from '../index';
import { invoices } from '../schema/finances';
import { expenses } from '../schema/finances';
import { payments } from '../schema/finances';
import { coupons, couponUsages } from '../schema/packages';
import { clubMembers } from '../schema/club-members';

// ─── Overview ─────────────────────────────────────────────────────────

export async function getFinanceOverview(clubId: string) {
  const [revenueResult, expenseResult, outstandingResult, paymentMethodBreakdown] = await Promise.all([
    db
      .select({ total: sql<number>`coalesce(sum(${payments.amount}), 0)::int` })
      .from(payments)
      .where(and(eq(payments.clubId, clubId), sql`${payments.status} = 'paid'`)),
    db
      .select({ total: sql<number>`coalesce(sum(${expenses.amount}), 0)::int` })
      .from(expenses)
      .where(eq(expenses.clubId, clubId)),
    db
      .select({ total: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)::int` })
      .from(invoices)
      .where(and(eq(invoices.clubId, clubId), sql`${invoices.status} IN ('sent', 'overdue')`)),
    db
      .select({
        method: payments.paymentMethod,
        total: sql<number>`coalesce(sum(${payments.amount}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(payments)
      .where(and(eq(payments.clubId, clubId), sql`${payments.status} = 'paid'`))
      .groupBy(payments.paymentMethod),
  ]);

  return {
    totalRevenue: revenueResult[0]?.total ?? 0,
    totalExpenses: expenseResult[0]?.total ?? 0,
    outstandingBalance: outstandingResult[0]?.total ?? 0,
    paymentMethodBreakdown: paymentMethodBreakdown,
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
      .innerJoin(clubMembers, eq(payments.memberId, clubMembers.id))
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
          eq(couponUsages.couponId, coupon.id),
          eq(couponUsages.riderMemberId, params.riderMemberId),
        ),
      );
    if ((riderUsage[0]?.count ?? 0) >= coupon.maxUsesPerRider) {
      return { valid: false, discount: 0, error: 'You have already used this promo code' };
    }
  }

  if (coupon.minimumAmount && params.amount < coupon.minimumAmount) {
    return { valid: false, discount: 0, error: `Minimum spend of ${(coupon.minimumAmount / 100).toFixed(2)} required` };
  }

  // Calculate discount
  let discount: number;
  if (coupon.discountType === 'percentage') {
    discount = Math.round(params.amount * (coupon.discountValue / 100));
    if (coupon.maxDiscount) {
      discount = Math.min(discount, coupon.maxDiscount);
    }
  } else {
    discount = coupon.discountValue;
  }

  // Discount cannot exceed order total
  discount = Math.min(discount, params.amount);

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
      .innerJoin(clubMembers, eq(invoices.memberId, clubMembers.id))
      .where(where)
      .orderBy(desc(invoices.createdAt))
      .limit(filters.pageSize)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(invoices).where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}
