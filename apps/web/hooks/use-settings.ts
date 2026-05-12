'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type ApiSuccessResponse,
  type ClubSettings,
  type NotificationPreferences,
} from '@equestrian/shared/types';
import {
  type UpdateClubProfileInput,
  type UpdateBrandingInput,
  type UpdateNotificationsInput,
  type UpdateDiscoveryInput,
  type UpdateBookingRulesInput,
} from '@equestrian/shared/schemas';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): `ClubSettings` and
// `NotificationPreferences` are now in
// `packages/shared/src/types/responses/settings.ts`. Re-exported below.
export type { ClubSettings, NotificationPreferences };

export function useClubSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => fetchJson<ApiSuccessResponse<ClubSettings>>('/api/v1/settings'),
  });
}

// Audit QA-25 — union of every settings sub-schema accepted by the
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
