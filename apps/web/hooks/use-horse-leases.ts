'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetch-json';
import {
  type ApiSuccessResponse,
  type ApiResponse,
} from '@equestrian/shared/types';
import {
  type CreateHorseLeaseInput,
  type SetLeaseStatusInput,
} from '@equestrian/shared/schemas';

export type LeaseType = 'half' | 'full';
export type LeaseStatus = 'pending' | 'active' | 'ended' | 'cancelled';

export interface HorseLeaseRow {
  id: string;
  leaseType: LeaseType;
  lesseeMemberId: string;
  lesseeName: string | null;
  lesseeEmail: string | null;
  monthlyFeeMinor: number;
  currency: string;
  startDate: string;
  endDate: string;
  status: LeaseStatus;
  notes: string | null;
  createdAt: string;
}

const leasesKey = (horseId: string) => ['horse-leases', horseId] as const;

export function useHorseLeases(horseId: string) {
  return useQuery({
    queryKey: leasesKey(horseId),
    queryFn: () =>
      fetchJson<ApiSuccessResponse<HorseLeaseRow[]>>(`/api/v1/horses/${horseId}/leases`),
    enabled: !!horseId,
  });
}

export function useCreateHorseLease(horseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateHorseLeaseInput) =>
      fetchJson<ApiResponse<HorseLeaseRow>>(`/api/v1/horses/${horseId}/leases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leasesKey(horseId) });
    },
  });
}

export function useTransitionHorseLease(horseId: string, leaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SetLeaseStatusInput) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/horses/${horseId}/leases/${leaseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leasesKey(horseId) });
    },
  });
}
