'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type HorseFiltersInput, type CreateHorseInput, type UpdateHorseInput } from '@equestrian/shared/schemas';
import {
  type ApiResponse,
  type PaginatedResponse,
  type Horse,
  type HorseListItem,
} from '@equestrian/shared/types';
import { STALE_TIME_FREQUENT } from '@equestrian/shared/constants';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): `Horse` and `HorseListItem` now live
// in `packages/shared/src/types/responses/horses.ts` so the mobile hook
// narrows against the same shape. Re-exported here so existing
// `import { type Horse } from '@/hooks/use-horses'` consumers keep working.
export type { Horse, HorseListItem };

export function useHorses(filters: Partial<HorseFiltersInput> = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.skillLevel) params.set('skillLevel', filters.skillLevel);
  if (filters.ownershipStatus) params.set('ownershipStatus', filters.ownershipStatus);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    // Audit F-70 (2026-05-08 r6): split list vs detail query keys with a
    // discriminator segment so a list invalidation doesn't evict every
    // detail-by-id entry (and vice-versa). Mutation invalidations below
    // target either `['horses', 'list']` (mutations that change list
    // membership) or `['horses', 'detail', id]` (mutations that only
    // affect a single horse). Mass invalidations that need both can hit
    // `['horses']` to evict everything.
    queryKey: ['horses', 'list', filters],
    queryFn: () => fetchJson<PaginatedResponse<HorseListItem>>(`/api/v1/horses?${params.toString()}`),
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
      void queryClient.invalidateQueries({ queryKey: ['horses', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['horses', 'detail', horseId] });
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
      void queryClient.invalidateQueries({ queryKey: ['horses', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['horses', 'detail', horseId] });
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
      void queryClient.invalidateQueries({ queryKey: ['horses', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['horses', 'detail', horseId] });
    },
  });
}

export function useHorse(horseId: string) {
  return useQuery({
    // Audit F-70 (2026-05-08 r6): see `useHorses` above for the rationale.
    queryKey: ['horses', 'detail', horseId],
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
      void queryClient.invalidateQueries({ queryKey: ['horses', 'list'] });
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
      void queryClient.invalidateQueries({ queryKey: ['horses', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['horses', 'detail', horseId] });
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
      void queryClient.invalidateQueries({ queryKey: ['horses', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['horses', 'detail', horseId] });
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
      void queryClient.invalidateQueries({ queryKey: ['horses', 'list'] });
    },
  });
}
