/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated horse response DTOs.
 *
 * Source of truth on the wire is the route handler's projection in
 * `packages/db/src/queries/horses.ts` (`getHorsesByClub` for the list shape,
 * `getHorseById` for the detail shape). These types previously lived
 * duplicated in `apps/web/hooks/use-horses.ts` and `apps/mobile/hooks/use-horses.ts`
 * — the mobile copy declared `status: string` while web declared the precise
 * union, and a column added to the projection only got reflected in one
 * consumer at a time. Single declaration here keeps both apps narrowing
 * against the same shape.
 *
 * `packages/shared` does NOT depend on `@equestrian/db`, so we can't
 * re-export `HorseAvailableForMatching = Awaited<ReturnType<typeof
 * getAvailableHorsesForMatching>>[number]` directly. The shapes below mirror
 * the projection by hand; if the projection grows a column, mirror it here
 * and let the type-checker catch the consumers.
 */

import type { HorseStatus, SkillLevel, HorseSaleStatus } from '../index';

// Mirror of `horseOwnershipStatusEnum` — declared inline because the
// project-wide enum constants don't currently expose this one.
export type HorseOwnershipStatus = 'pending' | 'active' | 'retired' | 'declined';

/**
 * Row shape returned by `GET /api/v1/horses` (paginated). Mirrors the
 * `getHorsesByClub` projection in `packages/db/src/queries/horses.ts`.
 */
export interface HorseListItem {
  id: string;
  clubId: string;
  name: string;
  primaryPhotoUrl: string | null;
  breed: string | null;
  gender: string | null;
  color: string | null;
  heightHands: string | null;
  weightKg: string | null;
  status: HorseStatus;
  skillLevel: SkillLevel;
  weightLimitKg: string | null;
  notes: string | null;
  ownerMemberId: string | null;
  ownershipStatus: HorseOwnershipStatus;
  ownershipSubmittedAt: string | null;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Detail shape returned by `GET /api/v1/horses/[horseId]`. Mirrors
 * `getHorseById` in the queries package.
 */
export interface Horse {
  id: string;
  name: string;
  barnName: string | null;
  breed: string | null;
  gender: string | null;
  color: string | null;
  dateOfBirth: string | null;
  heightHands: string | null;
  weightKg: string | null;
  markings: string | null;
  microchipNumber: string | null;
  passportNumber: string | null;
  registrationNumber: string | null;
  status: HorseStatus;
  skillLevel: SkillLevel;
  temperament: string[] | null;
  weightLimitKg: string | null;
  minRiderAge: number | null;
  maxLessonsPerDay: number;
  mandatoryRestDays: number;
  saleStatus: HorseSaleStatus;
  purchasePrice: number | null;
  currentValue: number | null;
  salePrice: number | null;
  saddleSize: string | null;
  girthSize: string | null;
  bridleSize: string | null;
  bitType: string | null;
  bitSize: string | null;
  blanketSize: string | null;
  bootsSize: string | null;
  gearNotes: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceCoverage: string | null;
  insuranceExpiry: string | null;
  primaryPhotoUrl: string | null;
  photoUrls: string[] | null;
  ownerMemberId: string | null;
  notes: string | null;
  ownershipStatus: HorseOwnershipStatus;
  monthlyLiveryFeeMinor: number | null;
  liveryStartDate: string | null;
  liveryEndDate: string | null;
  ownershipDeclineReason: string | null;
  ownershipSubmittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerName: string | null;
  ownerEmail?: string | null;
  ownerClerkUserId?: string | null;
  clubCurrency?: string;
}

/**
 * Mobile list-card shape (`apps/mobile/hooks/use-horses.ts` previously declared
 * a separate, looser version). Same wire row as `HorseListItem`; kept as an
 * alias so mobile can adopt the precise union without a breaking import path.
 */
export type HorseMobileListItem = HorseListItem;
