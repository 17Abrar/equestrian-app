'use client';

import { useQuery } from '@tanstack/react-query';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { STALE_TIME_FREQUENT } from '@equestrian/shared/constants';

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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed');
  }
  return data as T;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => fetchJson<ApiSuccessResponse<DashboardStats>>('/api/v1/dashboard'),
    staleTime: STALE_TIME_FREQUENT,
  });
}
