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
import { type ApiResponse, type ApiSuccessResponse, type PaginatedResponse } from '@equestrian/shared/types';

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
  status: string;
  paymentStatus: string;
  amount: number | null;
  currency: string;
  horseMatchScore: number | null;
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

// ─── Fetch Helper ─────────────────────────────────────────────────────

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed');
  }
  return data as T;
}

// ─── Arenas ───────────────────────────────────────────────────────────

export function useArenas() {
  return useQuery({
    queryKey: ['arenas'],
    queryFn: () => fetchJson<ApiSuccessResponse<Arena[]>>('/api/v1/arenas'),
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
      queryClient.invalidateQueries({ queryKey: ['arenas'] });
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
      queryClient.invalidateQueries({ queryKey: ['arenas'] });
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
      queryClient.invalidateQueries({ queryKey: ['arenas'] });
    },
  });
}

// ─── Lesson Types ─────────────────────────────────────────────────────

export function useLessonTypes() {
  return useQuery({
    queryKey: ['lessonTypes'],
    queryFn: () => fetchJson<ApiSuccessResponse<LessonType[]>>('/api/v1/lesson-types'),
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
      queryClient.invalidateQueries({ queryKey: ['lessonTypes'] });
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
      queryClient.invalidateQueries({ queryKey: ['lessonTypes'] });
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
      queryClient.invalidateQueries({ queryKey: ['lessonTypes'] });
    },
  });
}

// ─── Booking Slots ────────────────────────────────────────────────────

export function useBookingSlots(filters: { date?: string; dateFrom?: string; dateTo?: string; lessonTypeId?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.date) params.set('date', filters.date);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.lessonTypeId) params.set('lessonTypeId', filters.lessonTypeId);

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
      queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
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
      queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
  });
}

export function useCancelBookingSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ slotId, reason }: { slotId: string; reason?: string }) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/booking-slots/${slotId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
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
      queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
  });
}

// ─── Bookings ─────────────────────────────────────────────────────────

export function useBookings(filters: Partial<BookingFiltersInput> = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.date) params.set('date', filters.date);
  if (filters.lessonTypeId) params.set('lessonTypeId', filters.lessonTypeId);
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
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
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
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
      queryClient.invalidateQueries({ queryKey: ['bookingSlots'] });
    },
  });
}
