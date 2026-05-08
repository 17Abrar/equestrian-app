/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): consolidated horse-health DTOs.
 * Source projections live in `packages/db/src/queries/horse-health.ts`
 * (`getHealthRecords`, `getMedications`, `getMedicationLogs`, etc.).
 *
 * These are LIST-row shapes — the query layer narrows out encrypted PHI
 * columns (`description`/`diagnosis`/`treatment` on health records, `notes`
 * on medications) before serializing. Detail GETs that re-include them
 * would use a wider type, but no detail route exists today (audit F-32).
 */

export interface HealthRecord {
  id: string;
  horseId: string;
  recordType: string;
  title: string;
  date: string;
  nextDueDate: string | null;
  vetName: string | null;
  vetClinic: string | null;
  cost: number | null;
  recoveryTimeDays: number | null;
  followUpNeeded: boolean;
  followUpDate: string | null;
  batchNumber: string | null;
  productUsed: string | null;
  documentUrls: string[] | null;
  createdAt: string;
}

export interface Medication {
  id: string;
  horseId: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  timeOfDay: string[] | null;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  prescribedBy: string | null;
  createdAt: string;
}

export interface MedicationLog {
  id: string;
  medicationId: string;
  administeredAt: string;
  wasAdministered: boolean;
  skipReason: string | null;
  notes: string | null;
  createdAt: string;
}

export interface FeedingPlan {
  id: string;
  horseId: string;
  mealName: string;
  feedType: string | null;
  quantityKg: string | null;
  supplements: string[] | null;
  notes: string | null;
  timeOfDay: string | null;
  createdAt: string;
}

export interface ExerciseSchedule {
  id: string;
  horseId: string;
  dayOfWeek: number;
  exerciseType: string;
  durationMinutes: number | null;
  intensity: string | null;
  notes: string | null;
  createdAt: string;
}

export interface HorseDocument {
  id: string;
  horseId: string;
  fileName: string;
  fileUrl: string;
  fileSizeBytes: number | null;
  fileType: string | null;
  category: string;
  description: string | null;
  createdAt: string;
}
