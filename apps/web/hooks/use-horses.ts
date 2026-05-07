'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type HorseFiltersInput, type CreateHorseInput, type UpdateHorseInput } from '@equestrian/shared/schemas';
import { type ApiResponse, type PaginatedResponse } from '@equestrian/shared/types';
import { STALE_TIME_FREQUENT } from '@equestrian/shared/constants';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-8 (2026-05-07 r4): list-card narrow shape. The route's
// `getHorsesByClub` projection serializes only these fields; using `Horse`
// (the wide single-horse shape) here would have lied about what's on the
// wire and let consumers reach into fields that arrive as `undefined`.
export interface HorseListItem {
  id: string;
  clubId: string;
  name: string;
  primaryPhotoUrl: string | null;
  breed: string | null;
  gender: string | null;
  color: string | null;
  heightHands: string | null;
  weightKg: string | null;
  status: 'available' | 'resting' | 'injured' | 'retired' | 'off_site' | 'sold';
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  weightLimitKg: string | null;
  notes: string | null;
  ownerMemberId: string | null;
  ownershipStatus: 'pending' | 'active' | 'retired' | 'declined';
  ownershipSubmittedAt: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Horse {
  id: string;
  name: string;
  barnName: string | null;
  breed: string | null;
  gender: string | null;
  color: string | null;
  dateOfBirth: string | null;
  heightHands: string | null;
  weightKg: string | null;
  markings: string | null;
  microchipNumber: string | null;
  passportNumber: string | null;
  registrationNumber: string | null;
  // Audit LOW (2026-05-05 pass 2): tightened from `string` to the
  // matching DB enum unions so consumers don't need `as` casts to bind
  // the values to Selects / forms. Mirrors `horseStatusEnum` etc. in
  // `packages/db/src/schema/enums.ts`.
  status: 'available' | 'resting' | 'injured' | 'retired' | 'off_site' | 'sold';
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  temperament: string[] | null;
  weightLimitKg: string | null;
  minRiderAge: number | null;
  maxLessonsPerDay: number;
  mandatoryRestDays: number;
  saleStatus: 'not_for_sale' | 'for_sale' | 'sold';
  purchasePrice: number | null;
  currentValue: number | null;
  salePrice: number | null;
  saddleSize: string | null;
  girthSize: string | null;
  bridleSize: string | null;
  bitType: string | null;
  bitSize: string | null;
  blanketSize: string | null;
  bootsSize: string | null;
  gearNotes: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceCoverage: string | null;
  insuranceExpiry: string | null;
  primaryPhotoUrl: string | null;
  photoUrls: string[] | null;
  ownerMemberId: string | null;
  notes: string | null;
  ownershipStatus: 'pending' | 'active' | 'retired' | 'declined';
  monthlyLiveryFeeMinor: number | null;
  liveryStartDate: string | null;
  liveryEndDate: string | null;
  ownershipDeclineReason: string | null;
  ownershipSubmittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerName: string | null;
  ownerEmail?: string | null;
  ownerClerkUserId?: string | null;
  clubCurrency?: string;
}

export function useHorses(filters: Partial<HorseFiltersInput> = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.skillLevel) params.set('skillLevel', filters.skillLevel);
  if (filters.ownershipStatus) params.set('ownershipStatus', filters.ownershipStatus);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    // Audit F-16 (2026-05-06 r2): TanStack Query 5+ uses `hashKey()`
    // which serializes filter objects deterministically — no cache
    // collision risk. Trade-off: invalidations on `['horses']`
    // evict every variant rather than the specific filter. That's
    // acceptable here (list views use 30s staleTime; mutations
    // explicitly invalidate the prefix). Flatten variants into
    // primitive elements only if cache eviction noise grows.
    queryKey: ['horses', filters],
    queryFn: () => fetchJson<PaginatedResponse<HorseListItem>>(`/api/v1/horses?${params.toString()}`),
    // STALE_TIME_FREQUENT (30s) dedupes back-to-back fetches (tab switches,
    // nav badges) while still feeling live. Mutations explicitly invalidate so
    // approvals reflect immediately without waiting on this window.
    staleTime: STALE_TIME_FREQUENT,
  });
}

interface ApproveInput {
  monthlyLiveryFeeMinor: number;
  liveryStartDate: string;
}

export function useApproveHorseOwnership(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ApproveInput) =>
      fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses'] });
    },
  });
}

export function useDeclineHorseOwnership(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}/decline`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses'] });
    },
  });
}

export function useRetireHorseOwnership(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (liveryEndDate?: string) =>
      fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}/retire`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liveryEndDate }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses'] });
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId] });
    },
  });
}

export function useHorse(horseId: string) {
  return useQuery({
    queryKey: ['horses', horseId],
    queryFn: () => fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}`),
    enabled: !!horseId,
  });
}

export function useCreateHorse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateHorseInput) =>
      fetchJson<ApiResponse<Horse>>('/api/v1/horses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses'] });
    },
  });
}

export function useUpdateHorse(horseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateHorseInput) =>
      fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses'] });
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId] });
    },
  });
}

export function useTransferHorseOwner(horseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ownerMemberId: string | null) =>
      fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}/owner`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerMemberId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses'] });
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId] });
    },
  });
}

export function useDeleteHorse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (horseId: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/horses/${horseId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses'] });
    },
  });
}
