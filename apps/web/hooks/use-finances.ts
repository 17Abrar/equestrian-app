'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type CreateExpenseInput, type UpdateExpenseInput, type CreateCouponInput } from '@equestrian/shared/schemas';
import {
  type ApiSuccessResponse,
  type ApiResponse,
  type CouponDiscountType,
  type CouponStatus,
  type InvoiceStatus,
  type PaginatedResponse,
  type PaymentMethod,
  type PaymentStatus,
} from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

interface FinanceOverview {
  totalRevenue: number;
  totalExpenses: number;
  outstandingBalance: number;
  paymentMethodBreakdown: Array<{ method: string | null; total: number; count: number }>;
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
  // Audit F-56 (2026-05-07 r5 PR Sigma): swap bare `string` for the project
  // enum unions from `@equestrian/shared/types`.
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
  // Audit F-56: invoice lifecycle is the InvoiceStatus enum.
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
  // Audit F-56: discount type / status are project-defined enums.
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

export function useFinanceOverview() {
  return useQuery({
    queryKey: ['finances', 'overview'],
    queryFn: () => fetchJson<ApiSuccessResponse<FinanceOverview>>('/api/v1/finances/overview'),
  });
}

export function useExpenses(filters: { category?: string; dateFrom?: string; dateTo?: string; page?: number; pageSize?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['finances', 'expenses', filters],
    queryFn: () => fetchJson<PaginatedResponse<Expense>>(`/api/v1/finances/expenses?${params.toString()}`),
  });
}

// Expense mutations affect both the expenses list AND the overview totals
// (expenses subtract from net revenue), so both keys are invalidated. The
// payments / invoices / coupons keys aren't touched — surgical invalidation
// keeps unrelated tabs from refetching every time someone adds a fuel receipt.
function invalidateExpenseQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['finances', 'expenses'] });
  void queryClient.invalidateQueries({ queryKey: ['finances', 'overview'] });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateExpenseInput) =>
      fetchJson<ApiResponse<Expense>>('/api/v1/finances/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateExpenseInput }) =>
      fetchJson<ApiResponse<Expense>>(`/api/v1/finances/expenses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/finances/expenses/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidateExpenseQueries(queryClient),
  });
}

export function usePayments(filters: { status?: string; page?: number; pageSize?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['finances', 'payments', filters],
    queryFn: () => fetchJson<PaginatedResponse<Payment>>(`/api/v1/finances/payments?${params.toString()}`),
  });
}

export function useInvoices(filters: { status?: string; page?: number; pageSize?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['finances', 'invoices', filters],
    queryFn: () => fetchJson<PaginatedResponse<Invoice>>(`/api/v1/finances/invoices?${params.toString()}`),
  });
}

export function useCoupons(filters: { status?: string; page?: number; pageSize?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['finances', 'coupons', filters],
    queryFn: () => fetchJson<PaginatedResponse<Coupon>>(`/api/v1/finances/coupons?${params.toString()}`),
  });
}

export function useCreateCoupon() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCouponInput) =>
      fetchJson<ApiResponse<Coupon>>('/api/v1/finances/coupons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finances', 'coupons'] });
    },
  });
}

// Audit F-52 (2026-05-07 r4): `status` was added to the PATCH route to
// allow active ↔ paused / both → expired transitions from the UI.
type UpdateCouponInput = Partial<CreateCouponInput> & {
  status?: 'active' | 'paused' | 'expired';
};

export function useUpdateCoupon(couponId: string) {
  const queryClient = useQueryClient();
  // Audit AI-25 — `Partial<CreateCouponInput>` matches the PATCH route's
  // `couponBaseSchema.partial()` shape; replaces the previous
  // `Record<string, unknown>` that lost type safety on the payload.
  return useMutation({
    mutationFn: (data: UpdateCouponInput) =>
      fetchJson<ApiResponse<Coupon>>(`/api/v1/finances/coupons/${couponId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finances', 'coupons'] });
    },
  });
}
