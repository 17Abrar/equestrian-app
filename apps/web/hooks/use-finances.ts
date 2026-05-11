'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type CreateExpenseInput,
  type UpdateExpenseInput,
  type CreateCouponInput,
} from '@equestrian/shared/schemas';
import {
  type ApiSuccessResponse,
  type ApiResponse,
  type PaginatedResponse,
  type FinanceOverview,
  type Expense,
  type Payment,
  type Invoice,
  type Coupon,
} from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): finance DTOs consolidated into
// `packages/shared/src/types/responses/finances.ts`. Re-exported below.
export type { FinanceOverview, Expense, Payment, Invoice, Coupon };

export function useFinanceOverview() {
  return useQuery({
    queryKey: ['finances', 'overview'],
    queryFn: () => fetchJson<ApiSuccessResponse<FinanceOverview>>('/api/v1/finances/overview'),
  });
}

export function useExpenses(
  filters: {
    category?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const params = new URLSearchParams();
  if (filters.category) params.set('category', filters.category);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['finances', 'expenses', filters],
    queryFn: () =>
      fetchJson<PaginatedResponse<Expense>>(`/api/v1/finances/expenses?${params.toString()}`),
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
    queryFn: () =>
      fetchJson<PaginatedResponse<Payment>>(`/api/v1/finances/payments?${params.toString()}`),
  });
}

export function useInvoices(filters: { status?: string; page?: number; pageSize?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['finances', 'invoices', filters],
    queryFn: () =>
      fetchJson<PaginatedResponse<Invoice>>(`/api/v1/finances/invoices?${params.toString()}`),
  });
}

export function useCoupons(filters: { status?: string; page?: number; pageSize?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['finances', 'coupons', filters],
    queryFn: () =>
      fetchJson<PaginatedResponse<Coupon>>(`/api/v1/finances/coupons?${params.toString()}`),
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
