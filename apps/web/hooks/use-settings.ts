'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiSuccessResponse } from '@equestrian/shared/types';

export interface ClubSettings {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  timezone: string;
  currency: string;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  description: string | null;
  websiteUrl: string | null;
  socialInstagram: string | null;
  socialFacebook: string | null;
  socialTiktok: string | null;
  advanceBookingDays: number;
  bookingCutoffHours: number;
  cancellationNoticeHours: number;
  defaultLessonDurationMinutes: number;
  allowOverbooking: boolean;
  overbookingLimit: number;
  defaultCalendarView: string;
  subscriptionTier: string;
  subscriptionStatus: string;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed');
  }
  return data as T;
}

export function useClubSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => fetchJson<ApiSuccessResponse<ClubSettings>>('/api/v1/settings'),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      fetchJson<ApiSuccessResponse<ClubSettings>>('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
