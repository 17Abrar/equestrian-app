'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import {
  type UpdateClubProfileInput,
  type UpdateBrandingInput,
  type UpdateNotificationsInput,
  type UpdateDiscoveryInput,
  type UpdateBookingRulesInput,
} from '@equestrian/shared/schemas';
import { fetchJson } from '@/lib/fetch-json';

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
  // Round 8 — horse ownership flow
  horse_registration_submitted?: { email: boolean };
  horse_registration_approved?: { email: boolean };
  horse_registration_declined?: { email: boolean };
  // Round 8.5 — livery billing
  livery_invoice_issued?: { email: boolean };
  livery_payment_received?: { email: boolean };
  livery_invoice_overdue?: { email: boolean };
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

export function useClubSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => fetchJson<ApiSuccessResponse<ClubSettings>>('/api/v1/settings'),
  });
}

// Audit AI-25 — union of every settings sub-schema accepted by the
// PATCH /api/v1/settings handler. Replaces the previous
// `Record<string, unknown>` that admitted any payload shape.
export type UpdateSettingsInput =
  | UpdateClubProfileInput
  | UpdateBrandingInput
  | UpdateNotificationsInput
  | UpdateDiscoveryInput
  | UpdateBookingRulesInput;

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateSettingsInput) =>
      fetchJson<ApiSuccessResponse<ClubSettings>>('/api/v1/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}
