/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated report DTOs.
 * Source projection: `packages/db/src/queries/reports.ts`.
 */

export interface RevenueDataPoint {
  date: string;
  revenue: number;
  count: number;
}

export interface LessonPopularity {
  lessonTypeName: string;
  count: number;
}

export interface HorseUtilization {
  horseName: string;
  bookingCount: number;
  maxLessonsPerDay: number;
}

export interface CancellationStats {
  totalBookings: number;
  cancelledBookings: number;
  noShowBookings: number;
}
