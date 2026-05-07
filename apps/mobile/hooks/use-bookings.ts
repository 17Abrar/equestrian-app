import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────

export interface BookingSlot {
  id: string;
  clubId: string;
  lessonTypeId: string;
  arenaId: string | null;
  coachMemberId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  maxRiders: number;
  currentRiders: number;
  isCancelled: boolean;
  createdAt: string;
  lessonTypeName: string;
  lessonTypeType: string;
  lessonTypeColor: string | null;
  lessonTypePrice: number;
  lessonTypeCurrency: string;
  arenaName: string | null;
  coachName: string | null;
}

export interface Booking {
  id: string;
  clubId: string;
  slotId: string;
  riderMemberId: string;
  horseId: string | null;
  status: string;
  paymentStatus: string;
  amount: number | null;
  currency: string;
  createdAt: string;
  slotDate: string;
  slotStartTime: string;
  slotEndTime: string;
  lessonTypeName: string;
  lessonTypeType: string;
  arenaName: string | null;
  riderName: string | null;
  horseName: string | null;
}

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
  return useQuery({
    queryKey: ['myBookings', filters],
    queryFn: () =>
      api.getPaginated<Booking>(`/api/v1/bookings?${params.toString()}`),
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
    mutationFn: ({ bookingId, reason: _reason }: { bookingId: string; reason: string }) =>
      api.delete<Booking>(`/api/v1/bookings/${bookingId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['myBookings'] });
      void queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
  });
}
