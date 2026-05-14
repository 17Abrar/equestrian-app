'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type ApiSuccessResponse,
  type PaymentAccount,
  type PaymentAccountStatus,
  type PaymentProviderName,
} from '@equestrian/shared/types';
import { STALE_TIME_STABLE } from '@equestrian/shared/constants';
import { fetchJson } from '@/lib/fetch-json';
import { reportMutationError } from '@/components/shared/report-mutation-error';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): `PaymentAccount`,
// `PaymentProviderName`, `PaymentAccountStatus`, and `BookingPaymentResult`
// are now in `packages/shared/src/types/responses/payment-accounts.ts`.
export type { PaymentAccount, PaymentAccountStatus, PaymentProviderName };

export function usePaymentAccounts() {
  return useQuery({
    queryKey: ['paymentAccounts'],
    queryFn: () => fetchJson<ApiSuccessResponse<PaymentAccount[]>>('/api/v1/payments/accounts'),
    // Audit 2026-05-13 (P1): payment-account state changes only on
    // connect/disconnect mutations (which already invalidate). Default
    // 30s staleTime caused a fresh fetch on every Settings → Payments
    // mount with a full credentials-decryption hop server-side.
    staleTime: STALE_TIME_STABLE,
  });
}

interface StripeConnectInput {
  secretKey: string;
  publishableKey: string;
  webhookSigningSecret?: string;
  makeActive?: boolean;
}

export function useConnectStripe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: StripeConnectInput) =>
      fetchJson<ApiSuccessResponse<PaymentAccount>>('/api/v1/payments/stripe/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['paymentAccounts'] });
    },
    onError: (err: unknown) => reportMutationError('payment_account.mutate', err),
  });
}

interface NGeniusConnectInput {
  apiKey: string;
  outletReference: string;
  realmName?: string;
  webhookHeaderName?: string;
  webhookHeaderValue?: string;
  /**
   * Audit LOW (2026-05-06): outlet's settlement currency. ISO 4217
   * 3-letter code. Defaults to AED at the API schema layer when
   * omitted, but the connect form should always send it.
   */
  defaultCurrency?: string;
  makeActive?: boolean;
}

export function useConnectNGenius() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: NGeniusConnectInput) =>
      fetchJson<ApiSuccessResponse<PaymentAccount>>('/api/v1/payments/n-genius/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['paymentAccounts'] });
    },
    onError: (err: unknown) => reportMutationError('payment_account.mutate', err),
  });
}

interface ZiinaConnectInput {
  apiKey: string;
  webhookSigningSecret?: string;
  makeActive?: boolean;
}

export function useConnectZiina() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ZiinaConnectInput) =>
      fetchJson<ApiSuccessResponse<PaymentAccount>>('/api/v1/payments/ziina/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['paymentAccounts'] });
    },
    onError: (err: unknown) => reportMutationError('payment_account.mutate', err),
  });
}

export function useSetActiveProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: PaymentProviderName) =>
      fetchJson<ApiSuccessResponse<PaymentAccount>>('/api/v1/payments/accounts/set-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['paymentAccounts'] });
    },
    onError: (err: unknown) => reportMutationError('payment_account.mutate', err),
  });
}

export function useDisconnectProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: PaymentProviderName) =>
      fetchJson<ApiSuccessResponse<PaymentAccount>>(`/api/v1/payments/accounts/${provider}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['paymentAccounts'] });
    },
    onError: (err: unknown) => reportMutationError('payment_account.mutate', err),
  });
}
