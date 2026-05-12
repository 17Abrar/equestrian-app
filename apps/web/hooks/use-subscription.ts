'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ApiSuccessResponse,
  type SubscriptionTier,
  type SubscriptionPlatformStatus,
  type SubscriptionInvoiceStatus,
  type SubscriptionInvoice,
  type OutstandingInvoice,
  type SubscriptionSummary,
} from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): subscription DTOs consolidated under
// `packages/shared/src/types/responses/subscription.ts`. Re-exported below.
//
// Names diverged because the local `SubscriptionStatus`/`InvoiceStatus`
// type aliases collided with the project-wide enums from
// `@equestrian/shared/types` — the platform-billing subscription status
// is `SubscriptionPlatformStatus` (per-club Cavaliq billing lifecycle)
// and the subscription-invoice status is `SubscriptionInvoiceStatus`
// (distinct from the per-rider booking InvoiceStatus). Re-exported under
// the original local names so consumers in `subscription-panel.tsx` etc.
// don't need to change.
export type { SubscriptionTier, SubscriptionInvoice, OutstandingInvoice, SubscriptionSummary };
export type SubscriptionStatus = SubscriptionPlatformStatus;
export type InvoiceStatus = SubscriptionInvoiceStatus;

export function useSubscription() {
  return useQuery({
    queryKey: ['subscription'],
    queryFn: () => fetchJson<ApiSuccessResponse<SubscriptionSummary>>('/api/v1/me/subscription'),
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
