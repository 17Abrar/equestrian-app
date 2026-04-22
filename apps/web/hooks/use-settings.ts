'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiSuccessResponse } from '@equestrian/shared/types';

export interface NotificationPreferences {
  booking_confirmation?: { email: boolean };
  booking_reminder_24h?: { email: boolean };
  booking_cancellation?: { email: boolean };
  payment_receipt?: { email: boolean };
  payment_failed?: { email: boolean };
  feed_alert?: { email: boolean };
  waitlist_promotion?: { email: boolean };
  rider_welcome?: { email: boolean };
  invoice_issued?: { email: boolean };
}

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
  lateCancellationFeePercent: string;
  noShowFeePercent: string;
  subscriptionTier: string;
  subscriptionStatus: string;
  brandPrimaryColor: string | null;
  brandSecondaryColor: string | null;
  faviconUrl: string | null;
  notificationPreferences: NotificationPreferences;
  isPublicListing: boolean;
  joinPolicy: string;
  shortDescription: string | null;
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
