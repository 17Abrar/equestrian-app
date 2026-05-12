'use client';

import { useQuery } from '@tanstack/react-query';
import { type ApiSuccessResponse, type DashboardStats } from '@equestrian/shared/types';
import { STALE_TIME_FREQUENT } from '@equestrian/shared/constants';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): `DashboardStats` is now in
// `packages/shared/src/types/responses/dashboard.ts`.
export type { DashboardStats };

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => fetchJson<ApiSuccessResponse<DashboardStats>>('/api/v1/dashboard'),
    staleTime: STALE_TIME_FREQUENT,
  });
}
