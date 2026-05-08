/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated competition DTOs.
 * Source projections live in `packages/db/src/queries/competitions.ts`.
 */

import type { CompetitionStatus, CompetitionEntryStatus, PaymentStatus } from '../index';

export interface Competition {
  id: string;
  clubId: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  location: string | null;
  disciplines: string[] | null;
  entryFee: number | null;
  currency: string;
  registrationDeadline: string | null;
  maxParticipants: number | null;
  status: CompetitionStatus;
  createdAt: string;
}

export interface CompetitionClass {
  id: string;
  clubId: string;
  competitionId: string;
  name: string;
  discipline: string | null;
  level: string | null;
  maxEntries: number | null;
  entryFee: number | null;
  currency: string;
  sortOrder: number;
}

export interface CompetitionEntry {
  id: string;
  classId: string;
  riderMemberId: string;
  horseId: string | null;
  status: CompetitionEntryStatus;
  paymentStatus: PaymentStatus;
  amount: number | null;
  currency: string;
  registeredAt: string;
  riderName: string | null;
  horseName: string | null;
}

export interface CompetitionResult {
  id: string;
  entryId: string;
  placing: number | null;
  timeSeconds: string | null;
  faults: number;
  notes: string | null;
  riderName: string | null;
  horseName: string | null;
}

export interface CalendarCompetition {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: CompetitionStatus;
  location: string | null;
}
