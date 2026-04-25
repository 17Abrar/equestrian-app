'use client';

import { useQuery } from '@tanstack/react-query';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { STALE_TIME_FREQUENT } from '@equestrian/shared/constants';
import { fetchJson } from '@/lib/fetch-json';

export interface DashboardStats {
  horses: {
    total: number;
    available: number;
  };
  riders: {
    total: number;
  };
  todayBookings: {
    total: number;
    confirmed: number;
    pending: number;
  };
  todaySlots: number;
  recentBookings: Array<{
    id: string;
    status: string;
    createdAt: string;
    slotDate: string;
    slotStartTime: string;
    riderName: string | null;
  }>;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => fetchJson<ApiSuccessResponse<DashboardStats>>('/api/v1/dashboard'),
    staleTime: STALE_TIME_FREQUENT,
  });
}
