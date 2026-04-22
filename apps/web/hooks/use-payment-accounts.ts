'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiSuccessResponse } from '@equestrian/shared/types';

export type PaymentProviderName = 'stripe' | 'n_genius' | 'ziina';
export type PaymentAccountStatus = 'pending' | 'connected' | 'disabled' | 'error';

export interface PaymentAccount {
  id: string;
  clubId: string;
  provider: PaymentProviderName;
  status: PaymentAccountStatus;
  isActive: boolean;
  externalAccountId: string | null;
  metadata: unknown;
  lastError: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      (data as { error?: { message?: string } }).error?.message ?? 'Request failed',
    );
  }
  return data as T;
}

export function usePaymentAccounts() {
  return useQuery({
    queryKey: ['paymentAccounts'],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<PaymentAccount[]>>('/api/v1/payments/accounts'),
  });
}

export function useConnectStripe() {
  return useMutation({
    mutationFn: () =>
      fetchJson<ApiSuccessResponse<{ redirectUrl: string }>>(
        '/api/v1/payments/stripe/connect',
        { method: 'POST' },
      ),
  });
}

interface NGeniusConnectInput {
  apiKey: string;
  outletReference: string;
  realmName?: string;
  webhookHeaderName?: string;
  webhookHeaderValue?: string;
  makeActive?: boolean;
}

export function useConnectNGenius() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: NGeniusConnectInput) =>
      fetchJson<ApiSuccessResponse<PaymentAccount>>(
        '/api/v1/payments/n-genius/connect',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentAccounts'] });
    },
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
      queryClient.invalidateQueries({ queryKey: ['paymentAccounts'] });
    },
  });
}

export function useSetActiveProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: PaymentProviderName) =>
      fetchJson<ApiSuccessResponse<PaymentAccount>>(
        '/api/v1/payments/accounts/set-active',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentAccounts'] });
    },
  });
}

export function useDisconnectProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (provider: PaymentProviderName) =>
      fetchJson<ApiSuccessResponse<PaymentAccount>>(
        `/api/v1/payments/accounts/${provider}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentAccounts'] });
    },
  });
}
