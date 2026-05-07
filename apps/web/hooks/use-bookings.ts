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
  type BookingStatus,
  type PaginatedResponse,
  type PaymentMethod,
  type PaymentStatus,
} from '@equestrian/shared/types';
import { MAX_PAGE_SIZE } from '@equestrian/shared/constants';
import { fetchJson } from '@/lib/fetch-json';
import { reportMutationError } from '@/components/shared/report-mutation-error';

// Audit LOW-12 (2026-05-05): default onError for high-stakes mutations.
// Some consumers call `mutate()` (non-async) with their own per-call
// `onError` that only surfaces a toast — the failure never reaches Sentry,
// so a backend regression hides behind a "try again" prompt. The hook-level
// onError fires alongside any per-call onError in TanStack Query v5, so
// the consumer's toast still works AND the error lands in observability.
function defaultMutationErrorReporter(mutationKey: string) {
  return (err: unknown) => reportMutationError(mutationKey, err);
}

// ─── Types ────────────────────────────────────────────────────────────

export interface Arena {
  id: string;
  clubId: string;
  name: string;
  capacity: number | null;
  surfaceType: string | null;
  hasLighting: boolean;
  isIndoor: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LessonType {
  id: string;
  clubId: string;
  name: string;
  type: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  currency: string;
  maxRiders: number;
  minRiders: number;
  maxSessionsPerDay: number | null;
  arenaId: string | null;
  isActive: boolean;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

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
  // Audit F-56 (2026-05-07 r5 PR Sigma): use the project-defined enum unions
  // from `@equestrian/shared/types` instead of bare `string` so a `status ===
  // 'comfirmed'` typo at the consumer site is a TypeScript error, not silent
  // dead code.
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  amount: number | null;
  currency: string;
  horseMatchScore: number | null;
  createdAt: string;
  slotDate: string;
  slotStartTime: string;
  slotEndTime: string;
  lessonTypeName: string;
  lessonTypeType: string;
  lessonTypePrice: number;
  lessonTypeCurrency: string;
  arenaName: string | null;
  riderName: string | null;
  horseName: string | null;
}

// ─── Arenas ───────────────────────────────────────────────────────────

// Audit F-6 / F-7 (2026-05-07 r4): see use-staff.ts header — picker pulls
// the full first page rather than the default-25 truncation.
export function useArenas() {
  return useQuery({
    queryKey: ['arenas'],
    queryFn: () =>
      fetchJson<PaginatedResponse<Arena>>(`/api/v1/arenas?pageSize=${MAX_PAGE_SIZE}`),
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
      void queryClient.invalidateQueries({ queryKey: ['arenas'] });
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
      void queryClient.invalidateQueries({ queryKey: ['arenas'] });
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
      void queryClient.invalidateQueries({ queryKey: ['arenas'] });
    },
  });
}

// ─── Lesson Types ─────────────────────────────────────────────────────

export function useLessonTypes() {
  return useQuery({
    queryKey: ['lessonTypes'],
    queryFn: () =>
      fetchJson<PaginatedResponse<LessonType>>(
        `/api/v1/lesson-types?pageSize=${MAX_PAGE_SIZE}`,
      ),
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
      void queryClient.invalidateQueries({ queryKey: ['lessonTypes'] });
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
      void queryClient.invalidateQueries({ queryKey: ['lessonTypes'] });
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
      void queryClient.invalidateQueries({ queryKey: ['lessonTypes'] });
    },
  });
}

// ─── Booking Slots ────────────────────────────────────────────────────

// Audit F-54 (2026-05-07 r4): the route schema accepts `coachMemberId`
// but the hook's filter type omitted it, so the per-coach calendar view
// can't filter slots. Expose it through.
export function useBookingSlots(filters: { date?: string; dateFrom?: string; dateTo?: string; lessonTypeId?: string; coachMemberId?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.date) params.set('date', filters.date);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.lessonTypeId) params.set('lessonTypeId', filters.lessonTypeId);
  if (filters.coachMemberId) params.set('coachMemberId', filters.coachMemberId);

  return useQuery({
    queryKey: ['bookingSlots', filters],
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
      void queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
  });
}

export function useUpdateBookingSlot(slotId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { date?: string; startTime?: string; endTime?: string; maxRiders?: number; arenaId?: string; coachMemberId?: string }) =>
      fetchJson<ApiResponse<BookingSlot>>(`/api/v1/booking-slots/${slotId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
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
      void queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
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
      void queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
  });
}

// ─── Bookings ─────────────────────────────────────────────────────────

export function useBookings(filters: Partial<BookingFiltersInput> = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.date) params.set('date', filters.date);
  if (filters.lessonTypeId) params.set('lessonTypeId', filters.lessonTypeId);
  if (filters.riderMemberId) params.set('riderMemberId', filters.riderMemberId);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['bookings', filters],
    queryFn: () => fetchJson<PaginatedResponse<Booking>>(`/api/v1/bookings?${params.toString()}`),
  });
}

export function useBooking(bookingId: string) {
  return useQuery({
    queryKey: ['bookings', bookingId],
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
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
  });
}

export interface CancelPreview {
  bookingId: string;
  isLate: boolean;
  fee: number;
  currency: string;
  cutoffTime: string;
  hoursUntilSlot: number;
  cancellationNoticeHours: number;
  lessonPrice: number;
}

export function useCancelPreview(bookingId: string | null) {
  return useQuery({
    queryKey: ['cancelPreview', bookingId],
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
      void queryClient.invalidateQueries({ queryKey: ['cancelPreview'] });
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
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
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['bookings'] });
      void queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
    onError: defaultMutationErrorReporter('booking.mark_complete'),
  });
}
