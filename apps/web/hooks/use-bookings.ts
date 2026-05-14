'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type BookingFiltersInput,
  type CreateBookingInput,
  type CreateBookingSlotInput,
  type CreateRecurringSlotsInput,
  type CreateArenaInput,
  type CreateLessonTypeInput,
} from '@equestrian/shared/schemas';
import {
  type ApiResponse,
  type ApiSuccessResponse,
  type PaginatedResponse,
  type Arena,
  type LessonType,
  type BookingSlot,
  type Booking,
  type CancelPreview,
} from '@equestrian/shared/types';
import { MAX_PAGE_SIZE } from '@equestrian/shared/constants';
import { fetchJson } from '@/lib/fetch-json';
import { reportMutationError } from '@/components/shared/report-mutation-error';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): `Arena | LessonType | BookingSlot |
// Booking | CancelPreview` now live in `packages/shared/src/types/responses/`
// so mobile + web narrow against the same shape (mobile previously typed
// `status: string`). Re-exported here for component-level imports like
// `import { type BookingSlot } from '@/hooks/use-bookings'`.
export type { Arena, LessonType, BookingSlot, Booking, CancelPreview };

// Audit LOW-12 (2026-05-05): default onError for high-stakes mutations.
// Some consumers call `mutate()` (non-async) with their own per-call
// `onError` that only surfaces a toast — the failure never reaches Sentry,
// so a backend regression hides behind a "try again" prompt. The hook-level
// onError fires alongside any per-call onError in TanStack Query v5, so
// the consumer's toast still works AND the error lands in observability.
function defaultMutationErrorReporter(mutationKey: string) {
  return (err: unknown) => reportMutationError(mutationKey, err);
}

// Audit pass-10 F-1 / F-5 (2026-05-14): apply the list/detail discriminator
// pattern (established for `bookings` in pass-9) to arenas + lesson_types +
// booking_slots so a future detail hook doesn't collide with the list key
// and so list-only invalidations don't evict cached detail rows.
const ARENAS_KEY = ['arenas'] as const;
const arenasListKey = () => [...ARENAS_KEY, 'list'] as const;

const LESSON_TYPES_KEY = ['lessonTypes'] as const;
const lessonTypesListKey = () => [...LESSON_TYPES_KEY, 'list'] as const;

// Booking-slot filters are normalized into a flat record so unknown
// throwaway keys on the caller's filter object don't blow up the query
// cache.
interface NormalizedBookingSlotFilters {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  lessonTypeId?: string;
  coachMemberId?: string;
}
const BOOKING_SLOTS_KEY = ['bookingSlots'] as const;
const bookingSlotsListKey = (filters: NormalizedBookingSlotFilters) =>
  [...BOOKING_SLOTS_KEY, 'list', filters] as const;

// ─── Arenas ───────────────────────────────────────────────────────────

// Audit F-6 / F-7 (2026-05-07 r4): see use-staff.ts header — picker pulls
// the full first page rather than the default-25 truncation.
export function useArenas() {
  return useQuery({
    queryKey: arenasListKey(),
    queryFn: () => fetchJson<PaginatedResponse<Arena>>(`/api/v1/arenas?pageSize=${MAX_PAGE_SIZE}`),
  });
}

export function useCreateArena() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateArenaInput) =>
      fetchJson<ApiResponse<Arena>>('/api/v1/arenas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ARENAS_KEY, 'list'] });
    },
  });
}

export function useUpdateArena(arenaId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<CreateArenaInput>) =>
      fetchJson<ApiResponse<Arena>>(`/api/v1/arenas/${arenaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ARENAS_KEY, 'list'] });
    },
  });
}

export function useDeleteArena() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (arenaId: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/arenas/${arenaId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...ARENAS_KEY, 'list'] });
    },
  });
}

// ─── Lesson Types ─────────────────────────────────────────────────────

export function useLessonTypes() {
  return useQuery({
    queryKey: lessonTypesListKey(),
    queryFn: () =>
      fetchJson<PaginatedResponse<LessonType>>(`/api/v1/lesson-types?pageSize=${MAX_PAGE_SIZE}`),
  });
}

export function useCreateLessonType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateLessonTypeInput) =>
      fetchJson<ApiResponse<LessonType>>('/api/v1/lesson-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...LESSON_TYPES_KEY, 'list'] });
    },
  });
}

export function useUpdateLessonType(lessonTypeId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<CreateLessonTypeInput>) =>
      fetchJson<ApiResponse<LessonType>>(`/api/v1/lesson-types/${lessonTypeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...LESSON_TYPES_KEY, 'list'] });
    },
  });
}

export function useDeleteLessonType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (lessonTypeId: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/lesson-types/${lessonTypeId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...LESSON_TYPES_KEY, 'list'] });
    },
  });
}

// ─── Booking Slots ────────────────────────────────────────────────────

// Audit F-54 (2026-05-07 r4): the route schema accepts `coachMemberId`
// but the hook's filter type omitted it, so the per-coach calendar view
// can't filter slots. Expose it through.
export function useBookingSlots(filters: NormalizedBookingSlotFilters = {}) {
  const params = new URLSearchParams();
  if (filters.date) params.set('date', filters.date);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.lessonTypeId) params.set('lessonTypeId', filters.lessonTypeId);
  if (filters.coachMemberId) params.set('coachMemberId', filters.coachMemberId);

  // Audit pass-10 F-5: pick out only the URL-bound fields so the cache
  // key can't be inflated by an unrelated property on the caller's
  // filter object.
  const normalized: NormalizedBookingSlotFilters = {
    date: filters.date,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    lessonTypeId: filters.lessonTypeId,
    coachMemberId: filters.coachMemberId,
  };

  return useQuery({
    queryKey: bookingSlotsListKey(normalized),
    queryFn: () =>
      fetchJson<ApiSuccessResponse<BookingSlot[]>>(`/api/v1/booking-slots?${params.toString()}`),
  });
}

export function useCreateBookingSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBookingSlotInput) =>
      fetchJson<ApiResponse<BookingSlot>>('/api/v1/booking-slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...BOOKING_SLOTS_KEY, 'list'] });
    },
  });
}

export function useUpdateBookingSlot(slotId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      date?: string;
      startTime?: string;
      endTime?: string;
      maxRiders?: number;
      arenaId?: string;
      coachMemberId?: string;
    }) =>
      fetchJson<ApiResponse<BookingSlot>>(`/api/v1/booking-slots/${slotId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...BOOKING_SLOTS_KEY, 'list'] });
    },
  });
}

export function useCancelBookingSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ slotId, reason }: { slotId: string; reason: string }) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/booking-slots/${slotId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...BOOKING_SLOTS_KEY, 'list'] });
    },
    onError: defaultMutationErrorReporter('booking_slot.cancel'),
  });
}

export function useCreateRecurringSlots() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRecurringSlotsInput) =>
      fetchJson<ApiResponse<{ created: number }>>('/api/v1/booking-slots/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...BOOKING_SLOTS_KEY, 'list'] });
    },
  });
}

// ─── Bookings ─────────────────────────────────────────────────────────

// Audit 2026-05-13 (P1): split bookings query keys into `list` and `detail`
// variants to match the use-horses.ts F-70 pattern. Previously both the
// list (`['bookings', filters]`) and the detail (`['bookings', bookingId]`)
// queries shared the same `['bookings']` prefix — every list mutation
// invalidation refetched every mounted detail entry, and a detail
// invalidation could mass-evict from cache. The narrow keys let mutations
// invalidate the right slice without thrash.
const BOOKINGS_KEY = ['bookings'] as const;
const bookingsListKey = (filters: Partial<BookingFiltersInput>) =>
  [...BOOKINGS_KEY, 'list', filters] as const;
const bookingDetailKey = (bookingId: string) => [...BOOKINGS_KEY, 'detail', bookingId] as const;

export function useBookings(filters: Partial<BookingFiltersInput> = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.date) params.set('date', filters.date);
  if (filters.lessonTypeId) params.set('lessonTypeId', filters.lessonTypeId);
  if (filters.riderMemberId) params.set('riderMemberId', filters.riderMemberId);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: bookingsListKey(filters),
    queryFn: () => fetchJson<PaginatedResponse<Booking>>(`/api/v1/bookings?${params.toString()}`),
  });
}

export function useBooking(bookingId: string) {
  return useQuery({
    queryKey: bookingDetailKey(bookingId),
    queryFn: () => fetchJson<ApiResponse<Booking>>(`/api/v1/bookings/${bookingId}`),
    enabled: !!bookingId,
  });
}

export function useCreateBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBookingInput) =>
      fetchJson<ApiResponse<Booking>>('/api/v1/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      // Invalidate only the list slice — no in-cache detail row exists yet
      // for a brand-new booking.
      void queryClient.invalidateQueries({ queryKey: [...BOOKINGS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: [...BOOKING_SLOTS_KEY, 'list'] });
      // Audit 2026-05-13 (P2): keep the dashboard tiles + finance
      // overview in sync after every booking mutation — both compute
      // booking-derived KPIs and were stale for up to 30s otherwise.
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['finances', 'overview'] });
    },
  });
}

export function useCancelPreview(bookingId: string | null) {
  // Audit pass-10 F-8: the `enabled` guard suppresses the network call when
  // bookingId is null, but TanStack Query still uses the key to cache the
  // (suspended) query. Replace `null` with a sentinel so the cache doesn't
  // accumulate a `['cancelPreview', null]` entry per dialog mount.
  return useQuery({
    queryKey: ['cancelPreview', bookingId ?? 'pending'],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<CancelPreview>>(`/api/v1/bookings/${bookingId}/cancel-preview`),
    enabled: !!bookingId,
  });
}

export function useCancelBooking() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ bookingId, reason }: { bookingId: string; reason: string }) =>
      fetchJson<ApiResponse<Booking>>(`/api/v1/bookings/${bookingId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: [...BOOKINGS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: bookingDetailKey(vars.bookingId) });
      void queryClient.invalidateQueries({ queryKey: [...BOOKING_SLOTS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['cancelPreview'] });
      // Audit 2026-05-13 (P2): see useCreateBooking — keep dashboard /
      // finance overview fresh after booking-state mutations.
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['finances', 'overview'] });
    },
    onError: defaultMutationErrorReporter('booking.cancel'),
  });
}

export function useMarkNoShow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bookingId: string) =>
      fetchJson<ApiResponse<Booking>>(`/api/v1/bookings/${bookingId}/no-show`, {
        method: 'POST',
      }),
    onSuccess: (_data, bookingId) => {
      void queryClient.invalidateQueries({ queryKey: [...BOOKINGS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: bookingDetailKey(bookingId) });
      void queryClient.invalidateQueries({ queryKey: [...BOOKING_SLOTS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['finances', 'overview'] });
    },
    onError: defaultMutationErrorReporter('booking.no_show'),
  });
}

export function useMarkComplete() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (bookingId: string) =>
      fetchJson<ApiResponse<Booking>>(`/api/v1/bookings/${bookingId}/complete`, {
        method: 'POST',
      }),
    onSuccess: (_data, bookingId) => {
      void queryClient.invalidateQueries({ queryKey: [...BOOKINGS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: bookingDetailKey(bookingId) });
      void queryClient.invalidateQueries({ queryKey: [...BOOKING_SLOTS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['finances', 'overview'] });
    },
    onError: defaultMutationErrorReporter('booking.mark_complete'),
  });
}
