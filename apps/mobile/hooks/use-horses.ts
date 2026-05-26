import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  horseSkillLevelSchema,
  horseStatusSchema,
  horseOwnershipStatusSchema,
} from '@equestrian/shared/schemas/responses';
import { useApiClient } from '@/lib/api';

// Audit feature-walkthrough P0-A (2026-05-26): mobile previously called
// `/api/v1/horses` (gated by `horses:read`). Rider role lacks that
// permission, so every rider opening the Horses tab got a 403. The fix
// is to scope by Clerk user ID via `/api/v1/me/horses`, which returns
// the rider-owned horses across every club the user belongs to plus
// the list of clubs they can register a new horse at.
//
// The `/me/horses` projection is DIFFERENT from `/horses` (the club-
// scoped admin list). It includes club joins (clubName / clubSlug /
// clubCurrency) and livery fields, and OMITS admin-facing fields
// (weightLimitKg, notes, ownerMemberId, ownerName, updatedAt). The
// schema below mirrors `getHorsesOwnedByUser` in
// `packages/db/src/queries/horses.ts` and matches the `MyHorse`
// interface used by web's `apps/web/app/rider/horses/page.tsx`.
//
// `passthrough()` lets the server add fields without breaking the
// client validation; only MISSING fields trigger an `INVALID_RESPONSE`
// the api-client onError path forwards to Sentry.
const myHorseSchema = z
  .object({
    id: z.string().uuid(),
    clubId: z.string().uuid(),
    clubName: z.string(),
    clubSlug: z.string(),
    clubCurrency: z.string(),
    name: z.string(),
    breed: z.string().nullable(),
    gender: z.string().nullable(),
    color: z.string().nullable(),
    heightHands: z.string().nullable(),
    weightKg: z.string().nullable(),
    skillLevel: horseSkillLevelSchema,
    primaryPhotoUrl: z.string().nullable(),
    status: horseStatusSchema,
    ownershipStatus: horseOwnershipStatusSchema,
    monthlyLiveryFeeMinor: z.number().nullable(),
    liveryStartDate: z.string().nullable(),
    liveryEndDate: z.string().nullable(),
    ownershipDeclineReason: z.string().nullable(),
    ownershipSubmittedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .passthrough();

const myHorsesResponseSchema = z
  .object({
    horses: z.array(myHorseSchema),
    memberships: z.array(
      z.object({
        memberId: z.string().uuid(),
        clubId: z.string().uuid(),
        clubName: z.string(),
        clubSlug: z.string(),
        role: z.string(),
      }),
    ),
    pagination: z.object({
      page: z.number(),
      pageSize: z.number(),
      total: z.number(),
      totalPages: z.number(),
    }),
  })
  .passthrough();

export type Horse = z.infer<typeof myHorseSchema>;
export type MyHorsesResponse = z.infer<typeof myHorsesResponseSchema>;
export type MyHorsesMembership = MyHorsesResponse['memberships'][number];

export function useHorses(options: { page?: number } = {}) {
  const api = useApiClient();
  const params = new URLSearchParams();
  if (options.page) params.set('page', String(options.page));
  params.set('pageSize', '50');

  return useQuery({
    queryKey: ['me-horses', options],
    queryFn: () =>
      api.get<MyHorsesResponse>(`/api/v1/me/horses?${params.toString()}`, {
        schema: myHorsesResponseSchema,
      }),
  });
}
