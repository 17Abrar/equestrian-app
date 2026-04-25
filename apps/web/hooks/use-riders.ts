'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type RiderFiltersInput, type UpdateRiderProfileInput, type CreateRiderInput } from '@equestrian/shared/schemas';
import { type ApiResponse, type PaginatedResponse } from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

export interface Rider {
  id: string;
  clubId: string;
  memberId: string;
  dateOfBirth: string | null;
  weightKg: string | null;
  heightCm: string | null;
  skillLevel: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  medicalNotes: string | null;
  totalLessonsCompleted: number;
  parentMemberId: string | null;
  createdAt: string;
  updatedAt: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
}

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
      queryClient.invalidateQueries({ queryKey: ['riders'] });
      queryClient.invalidateQueries({ queryKey: ['riders', riderId] });
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
      queryClient.invalidateQueries({ queryKey: ['riders'] });
    },
  });
}
