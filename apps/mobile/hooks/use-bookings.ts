import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type Booking, type BookingSlot } from '@equestrian/shared/types';
import { bookingListItemSchema } from '@equestrian/shared/schemas/responses';
import { useApiClient } from '@/lib/api';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): mobile previously declared trimmed
// `Booking` and `BookingSlot` shapes locally with `status: string` etc.
// Both apps now narrow against the consolidated DTOs from
// `packages/shared/src/types/responses/bookings.ts`.
export type { Booking, BookingSlot };

interface MeData {
  memberId: string | null;
  role: string;
  displayName: string | null;
  email: string | null;
}

// ─── Hooks ────────────────────────────────────────────────────────────

export function useMe() {
  const api = useApiClient();

  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeData>('/api/v1/me'),
  });
}

export function useBookingSlots(filters: { dateFrom?: string; dateTo?: string } = {}) {
  const api = useApiClient();
  const params = new URLSearchParams();
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);

  // /api/v1/booking-slots returns `successResponse(slot[])` — non-paginated
  // (the route enforces a 90-day window cap), so plain `get<BookingSlot[]>`
  // is correct here.
  return useQuery({
    queryKey: ['bookingSlots', filters],
    queryFn: () =>
      api.get<BookingSlot[]>(`/api/v1/booking-slots?${params.toString()}`),
  });
}

export function useMyBookings(filters: { status?: string; page?: number } = {}) {
  const api = useApiClient();
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  params.set('pageSize', '25');

  // Audit F-6 (2026-05-07 r5 PR Sigma): /api/v1/bookings returns the
  // paginated envelope, so use `getPaginated<Booking>` for the
  // properly-typed discriminated union.
  // Audit F-69 companion (2026-05-08 r6): `validate:` runs each item
  // through `bookingListItemSchema` so a server-side projection drift
  // surfaces an INVALID_RESPONSE with the offending field captured by
  // Sentry, rather than a silent `undefined` deref on the My Bookings
  // screen.
  return useQuery({
    queryKey: ['myBookings', filters],
    queryFn: () =>
      api.getPaginated<Booking>(`/api/v1/bookings?${params.toString()}`, {
        schema: bookingListItemSchema,
      }),
  });
}

export function useCreateBooking() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  // The booking route returns the booking row plus any auto-match metadata
  // (`paymentStatus` lives on the row itself, populated server-side from the
  // booking creation flow). Keep the post type to a single booking to avoid
  // re-introducing the `as { id: string; paymentStatus: string }` cast at
  // the consumer (audit F-7).
  return useMutation({
    mutationFn: (data: {
      slotId: string;
      riderMemberId: string;
      autoMatchHorse?: boolean;
      couponCode?: string;
    }) => api.post<Booking>('/api/v1/bookings', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['myBookings'] });
      void queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
  });
}

export function useCancelBooking() {
  const api = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bookingId, reason }: { bookingId: string; reason: string }) =>
      // Audit pass-4 M-2 (2026-05-10): server expects
      // `cancelBookingSchema`-typed body via DELETE — was previously
      // dropping `reason` on the floor (renamed to `_reason`).
      // `cancellationReason` lands in the booking row and the audit
      // log; without it the trail shows reason-less cancels.
      api.delete<Booking>(`/api/v1/bookings/${bookingId}`, { reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['myBookings'] });
      void queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
  });
}
