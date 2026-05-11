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

export function useRiders(filters: Partial<RiderFiltersInput> = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.skillLevel) params.set('skillLevel', filters.skillLevel);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['riders', filters],
    queryFn: () => fetchJson<PaginatedResponse<Rider>>(`/api/v1/riders?${params.toString()}`),
  });
}

export function useRider(riderId: string) {
  return useQuery({
    queryKey: ['riders', riderId],
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
      void queryClient.invalidateQueries({ queryKey: ['riders'] });
      void queryClient.invalidateQueries({ queryKey: ['riders', riderId] });
    },
  });
}

export function useCreateRider() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRiderInput) =>
      fetchJson<ApiResponse<unknown>>('/api/v1/riders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['riders'] });
    },
  });
}
