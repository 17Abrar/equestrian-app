/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated staff/member DTOs.
 * Source projection: `packages/db/src/queries/staff.ts` (`getMembers`,
 * `getStaffByClub`, `getOwnersByClub`). Mirrors the `club_members` row that
 * the routes return for staff/owner/coach/rider pickers.
 */

import type { UserRole } from '../index';

export interface ClubMember {
  id: string;
  clerkUserId: string;
  role: UserRole;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}
