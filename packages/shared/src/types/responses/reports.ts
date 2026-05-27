/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated report DTOs.
 * Source projection: `packages/db/src/queries/reports.ts`.
 */

export interface RevenueDataPoint {
  date: string;
  /**
   * Audit P1 (2026-05-26): ISO-4217 currency code from the underlying
   * `bookings.currency`. A club with bookings in multiple currencies
   * produces one row per `(date, currency)` pair — the consumer must
   * render and aggregate per currency rather than summing across them.
   */
  currency: string;
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
