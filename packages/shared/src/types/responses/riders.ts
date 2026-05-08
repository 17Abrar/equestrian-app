/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated rider DTOs.
 * Source projection lives in `packages/db/src/queries/riders.ts`
 * (`getRidersByClub` returns the join with `club_members`).
 */

import type { SkillLevel } from '../index';

export interface Rider {
  id: string;
  clubId: string;
  memberId: string;
  dateOfBirth: string | null;
  weightKg: string | null;
  heightCm: string | null;
  skillLevel: SkillLevel;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  medicalNotes: string | null;
  totalLessonsCompleted: number;
  parentMemberId: string | null;
  createdAt: string;
  updatedAt: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
}
