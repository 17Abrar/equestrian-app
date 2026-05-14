'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiSuccessResponse, type BookingPaymentResult } from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';
import { reportMutationError } from '@/components/shared/report-mutation-error';

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
      //
      // Audit 2026-05-13 (P1): keys aligned with the list/detail split in
      // use-bookings.ts so we refresh the specific detail row + the list
      // slice without nuking unrelated detail entries.
      void queryClient.invalidateQueries({ queryKey: ['bookings', 'detail', bookingId] });
      void queryClient.invalidateQueries({ queryKey: ['bookings', 'list'] });
    },
    onError: (err: unknown) => {
      // Audit 2026-05-13 (P2 from hooks/lib sweep): payment-init failures
      // (auth/credentials/rate-limit) used to be silent to Sentry when the
      // caller used `mutate()` with their own try/catch. Hook-level
      // reporter ensures every failure reaches observability.
      reportMutationError('booking.payment_init', err);
    },
  });
}
