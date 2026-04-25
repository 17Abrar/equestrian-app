'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type CreateExpenseInput, type UpdateExpenseInput, type CreateCouponInput } from '@equestrian/shared/schemas';
import { type ApiSuccessResponse, type ApiResponse, type PaginatedResponse } from '@equestrian/shared/types';
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
  paymentMethod: string;
  status: string;
  description: string | null;
  paidAt: string | null;
  createdAt: string;
  memberName: string | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
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
  discountType: string;
  discountValue: number;
  maxDiscount: number | null;
  maxUses: number | null;
  maxUsesPerRider: number | null;
  usageCount: number;
  status: string;
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

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateExpenseInput) =>
      fetchJson<ApiResponse<Expense>>('/api/v1/finances/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finances'] });
    },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finances'] });
    },
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/finances/expenses/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finances'] });
    },
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
      queryClient.invalidateQueries({ queryKey: ['finances', 'coupons'] });
    },
  });
}

export function useUpdateCoupon(couponId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      fetchJson<ApiResponse<Coupon>>(`/api/v1/finances/coupons/${couponId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['finances', 'coupons'] });
    },
  });
}
