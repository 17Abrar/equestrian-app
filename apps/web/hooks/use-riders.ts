'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type RiderFiltersInput,
  type UpdateRiderProfileInput,
  type CreateRiderInput,
} from '@equestrian/shared/schemas';
import { type ApiResponse, type PaginatedResponse, type Rider } from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): `Rider` is now in
// `packages/shared/src/types/responses/riders.ts` with `skillLevel` typed as
// the project `SkillLevel` enum.
export type { Rider };

// Audit pass-10 F-2 / F-4 (2026-05-14): same list/detail key split as
// `use-bookings.ts`. Previously `useUpdateRider` invalidated the bare
// `['riders']` prefix, which forcibly evicted every cached detail entry on
// every list mutation — every rider profile page refetched on save. The
// normalized list-filter object keeps the cache from ballooning when a
// caller passes throwaway keys on the filter literal.
interface NormalizedRiderFilters {
  search?: string;
  skillLevel?: RiderFiltersInput['skillLevel'];
  page?: number;
  pageSize?: number;
}
const RIDERS_KEY = ['riders'] as const;
const ridersListKey = (filters: NormalizedRiderFilters) =>
  [...RIDERS_KEY, 'list', filters] as const;
const riderDetailKey = (riderId: string) => [...RIDERS_KEY, 'detail', riderId] as const;

export function useRiders(filters: Partial<RiderFiltersInput> = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.skillLevel) params.set('skillLevel', filters.skillLevel);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const normalized: NormalizedRiderFilters = {
    search: filters.search,
    skillLevel: filters.skillLevel,
    page: filters.page,
    pageSize: filters.pageSize,
  };

  return useQuery({
    queryKey: ridersListKey(normalized),
    queryFn: () => fetchJson<PaginatedResponse<Rider>>(`/api/v1/riders?${params.toString()}`),
  });
}

export function useRider(riderId: string) {
  return useQuery({
    queryKey: riderDetailKey(riderId),
    queryFn: () => fetchJson<ApiResponse<Rider>>(`/api/v1/riders/${riderId}`),
    enabled: !!riderId,
  });
}

export function useUpdateRider(riderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateRiderProfileInput) =>
      fetchJson<ApiResponse<Rider>>(`/api/v1/riders/${riderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...RIDERS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: riderDetailKey(riderId) });
    },
  });
}

export function useCreateRider() {
  const queryClient = useQueryClient();

  // Audit pass-10 F-3: the POST /riders endpoint returns the freshly
  // created Rider. Typing as `ApiResponse<Rider>` (instead of `unknown`)
  // restores the type contract so callers don't need to cast or re-type
  // the response.
  return useMutation({
    mutationFn: (data: CreateRiderInput) =>
      fetchJson<ApiResponse<Rider>>('/api/v1/riders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...RIDERS_KEY, 'list'] });
    },
  });
}
