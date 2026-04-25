'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import type { PaymentProviderName } from './use-payment-accounts';
import { fetchJson } from '@/lib/fetch-json';

/**
 * Payload returned from POST /api/v1/bookings/[id]/payment. The `flow`
 * discriminates the union: Stripe carries a `clientSecret` for inline
 * Elements; N-Genius and Ziina carry a `paymentUrl` for redirect.
 */
export type BookingPaymentResult =
  | {
      bookingId: string;
      provider: PaymentProviderName;
      providerPaymentId: string;
      flow: 'inline';
      clientSecret: string;
      status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'cancelled';
    }
  | {
      bookingId: string;
      provider: PaymentProviderName;
      providerPaymentId: string;
      flow: 'redirect';
      paymentUrl: string;
      status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'cancelled';
    };

export function usePaymentForBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) =>
      fetchJson<ApiSuccessResponse<BookingPaymentResult>>(
        `/api/v1/bookings/${bookingId}/payment`,
        { method: 'POST' },
      ),
    onSuccess: (_data, bookingId) => {
      // The booking row's payment_provider / provider_payment_id columns
      // were just written — refresh anything that might display them.
      queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}
