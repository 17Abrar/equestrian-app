'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiSuccessResponse, type BookingPaymentResult } from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): `BookingPaymentResult` is now in
// `packages/shared/src/types/responses/payment-accounts.ts`. Re-exported here
// so existing component imports keep working.
export type { BookingPaymentResult };

export function usePaymentForBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bookingId: string) =>
      fetchJson<ApiSuccessResponse<BookingPaymentResult>>(`/api/v1/bookings/${bookingId}/payment`, {
        method: 'POST',
      }),
    onSuccess: (_data, bookingId) => {
      // The booking row's payment_provider / provider_payment_id columns
      // were just written — refresh anything that might display them.
      void queryClient.invalidateQueries({ queryKey: ['booking', bookingId] });
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}
