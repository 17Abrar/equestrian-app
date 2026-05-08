/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated dashboard-overview DTO.
 * Source projection: `packages/db/src/queries/dashboard.ts`.
 */

import type { BookingStatus } from '../index';

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
    status: BookingStatus;
    createdAt: string;
    slotDate: string;
    slotStartTime: string;
    riderName: string | null;
  }>;
}
