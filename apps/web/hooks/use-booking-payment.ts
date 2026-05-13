'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiSuccessResponse, type BookingPaymentResult } from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): `BookingPaymentResult` is now in
// `packages/shared/src/types/responses/payment-accounts.ts`. Re-exported here
// so existing component imports keep working.
export type { BookingPaymentResult };

interface BookingPaymentVariables {
  bookingId: string;
  mode?: 'default' | 'hosted';
}

function normalizePaymentVariables(
  input: string | BookingPaymentVariables,
): BookingPaymentVariables {
  return typeof input === 'string' ? { bookingId: input } : input;
}

export function usePaymentForBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: string | BookingPaymentVariables) => {
      const { bookingId, mode } = normalizePaymentVariables(input);
      return fetchJson<ApiSuccessResponse<BookingPaymentResult>>(
        `/api/v1/bookings/${bookingId}/payment`,
        {
          method: 'POST',
          ...(mode
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode }),
              }
            : {}),
        },
      );
    },
    onSuccess: (_data, input) => {
      const { bookingId } = normalizePaymentVariables(input);
      // The booking row's payment_provider / provider_payment_id columns
      // were just written — refresh anything that might display them.
      void queryClient.invalidateQueries({ queryKey: ['bookings', bookingId] });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}
