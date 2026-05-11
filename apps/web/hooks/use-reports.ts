'use client';

import { useQuery } from '@tanstack/react-query';
import {
  type ApiSuccessResponse,
  type RevenueDataPoint,
  type LessonPopularity,
  type HorseUtilization,
  type CancellationStats,
} from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): report DTOs consolidated under
// `packages/shared/src/types/responses/reports.ts`.

export function useRevenueReport(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['reports', 'revenue', dateFrom, dateTo],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<RevenueDataPoint[]>>(
        `/api/v1/reports?type=revenue&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    enabled: !!dateFrom && !!dateTo,
  });
}

export function useLessonPopularityReport(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['reports', 'lessons', dateFrom, dateTo],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<LessonPopularity[]>>(
        `/api/v1/reports?type=lessons&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    enabled: !!dateFrom && !!dateTo,
  });
}

export function useHorseUtilizationReport(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['reports', 'horses', dateFrom, dateTo],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<HorseUtilization[]>>(
        `/api/v1/reports?type=horses&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    enabled: !!dateFrom && !!dateTo,
  });
}

export function useCancellationReport(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['reports', 'cancellations', dateFrom, dateTo],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<CancellationStats>>(
        `/api/v1/reports?type=cancellations&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    enabled: !!dateFrom && !!dateTo,
  });
}
