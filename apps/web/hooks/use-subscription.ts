'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

export type SubscriptionTier = 'trial' | 'starter' | 'growing' | 'professional';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled';
export type InvoiceStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

export interface SubscriptionInvoice {
  id: string;
  invoiceNumber: string;
  tier: SubscriptionTier;
  amountMinorUnits: number;
  currency: string;
  periodStart: string;
  periodEnd: string;
  status: InvoiceStatus;
  dueDate: string;
  paidAt: string | null;
  payLink: string | null;
  createdAt: string;
}

export interface OutstandingInvoice {
  id: string;
  invoiceNumber: string;
  amountMinorUnits: number;
  currency: string;
  dueDate: string;
  status: InvoiceStatus;
  payLink: string | null;
  tier: SubscriptionTier;
  periodStart: string;
  periodEnd: string;
}

export interface SubscriptionSummary {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentTierPriceMinor: number;
  currency: string;
  outstanding: OutstandingInvoice[];
  history: SubscriptionInvoice[];
}

export function useSubscription() {
  return useQuery({
    queryKey: ['subscription'],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<SubscriptionSummary>>('/api/v1/me/subscription'),
  });
}

export function useRefreshPayLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invoiceId: string) =>
      fetchJson<ApiSuccessResponse<{ payLink: string; providerPaymentId: string }>>(
        `/api/v1/me/subscription/invoices/${invoiceId}/pay-link`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
    },
  });
}
