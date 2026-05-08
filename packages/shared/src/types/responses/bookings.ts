/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated booking response DTOs.
 * Source-of-truth projections live in `packages/db/src/queries/bookings.ts`
 * (`getBookingSlots`, `getBookingsByClub`, `getBookingById`). These shapes
 * were previously duplicated across `apps/web/hooks/use-bookings.ts` and
 * `apps/mobile/hooks/use-bookings.ts` — mobile typed `status: string` while
 * web typed the precise enum, and any added column only landed in one place.
 */

import type {
  BookingStatus,
  PaymentStatus,
  PaymentMethod,
} from '../index';

export interface Arena {
  id: string;
  clubId: string;
  name: string;
  capacity: number | null;
  surfaceType: string | null;
  hasLighting: boolean;
  isIndoor: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LessonType {
  id: string;
  clubId: string;
  name: string;
  type: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  currency: string;
  maxRiders: number;
  minRiders: number;
  maxSessionsPerDay: number | null;
  arenaId: string | null;
  isActive: boolean;
  color: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingSlot {
  id: string;
  clubId: string;
  lessonTypeId: string;
  arenaId: string | null;
  coachMemberId: string | null;
  date: string;
  startTime: string;
  endTime: string;
  maxRiders: number;
  currentRiders: number;
  isCancelled: boolean;
  createdAt: string;
  lessonTypeName: string;
  lessonTypeType: string;
  lessonTypeColor: string | null;
  lessonTypePrice: number;
  lessonTypeCurrency: string;
  arenaName: string | null;
  coachName: string | null;
}

export interface Booking {
  id: string;
  clubId: string;
  slotId: string;
  riderMemberId: string;
  horseId: string | null;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod | null;
  amount: number | null;
  currency: string;
  horseMatchScore: number | null;
  createdAt: string;
  slotDate: string;
  slotStartTime: string;
  slotEndTime: string;
  lessonTypeName: string;
  lessonTypeType: string;
  lessonTypePrice: number;
  lessonTypeCurrency: string;
  arenaName: string | null;
  riderName: string | null;
  horseName: string | null;
}

export interface CancelPreview {
  bookingId: string;
  isLate: boolean;
  fee: number;
  currency: string;
  cutoffTime: string;
  hoursUntilSlot: number;
  cancellationNoticeHours: number;
  lessonPrice: number;
}

/**
 * Mobile previously declared trimmed `Booking` and `BookingSlot` shapes with
 * `status: string` etc. Kept as aliases so mobile narrows against the same
 * fully-typed shape without a breaking import path.
 */
export type BookingMobile = Booking;
export type BookingSlotMobile = BookingSlot;
