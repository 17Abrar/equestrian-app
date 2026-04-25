import { eq, and, asc, desc, sql, SQL } from 'drizzle-orm';
import { db } from '../index';
import {
  horseHealthRecords,
  horseMedications,
  horseMedicationLogs,
  horseFeedingPlans,
  horseExerciseSchedules,
  horseDocuments,
} from '../schema/horse-health';
import { decryptFields, encryptFields } from '../crypto';

// Columns on horse_health_records that contain regulated medical content.
// Stored encrypted at rest; decrypted only in the query layer.
const HEALTH_ENCRYPTED_FIELDS = ['description', 'diagnosis', 'treatment'] as const;

// Free-form clinical notes on medications are also PHI-sensitive.
const MEDICATION_ENCRYPTED_FIELDS = ['notes'] as const;

// ─── Types ────────────────────────────────────────────────────────────

type NewHealthRecord = typeof horseHealthRecords.$inferInsert;
type HealthRecordCreate = Omit<NewHealthRecord, 'id' | 'clubId' | 'horseId' | 'createdAt' | 'updatedAt'>;

type NewMedication = typeof horseMedications.$inferInsert;
type MedicationCreate = Omit<NewMedication, 'id' | 'clubId' | 'horseId' | 'createdAt' | 'updatedAt'>;

type NewMedicationLog = typeof horseMedicationLogs.$inferInsert;
type MedicationLogCreate = Omit<NewMedicationLog, 'id' | 'clubId' | 'horseId' | 'createdAt'>;

type NewFeedingPlan = typeof horseFeedingPlans.$inferInsert;
type DrizzleFeedingCreate = Omit<NewFeedingPlan, 'id' | 'clubId' | 'horseId' | 'createdAt' | 'updatedAt'>;

/** Accepts number for quantityKg — converts to string for Drizzle numeric column */
interface FeedingPlanCreate extends Omit<DrizzleFeedingCreate, 'quantityKg'> {
  quantityKg?: number | string | null;
}

type NewExercise = typeof horseExerciseSchedules.$inferInsert;
type ExerciseCreate = Omit<NewExercise, 'id' | 'clubId' | 'horseId' | 'createdAt' | 'updatedAt'>;

type NewDocument = typeof horseDocuments.$inferInsert;
type DocumentCreate = Omit<NewDocument, 'id' | 'clubId' | 'horseId' | 'createdAt'>;

// ─── Health Records ───────────────────────────────────────────────────

export async function getHealthRecords(clubId: string, horseId: string, recordType?: string) {
  const conditions: SQL[] = [
    eq(horseHealthRecords.clubId, clubId),
    eq(horseHealthRecords.horseId, horseId),
  ];

  if (recordType) {
    conditions.push(sql`${horseHealthRecords.recordType} = ${recordType}`);
  }

  const rows = await db
    .select()
    .from(horseHealthRecords)
    .where(and(...conditions))
    .orderBy(desc(horseHealthRecords.date));

  return rows.map((row) => decryptFields(row, HEALTH_ENCRYPTED_FIELDS));
}

export async function createHealthRecord(clubId: string, horseId: string, data: HealthRecordCreate) {
  const encrypted = encryptFields(data, HEALTH_ENCRYPTED_FIELDS);
  const result = await db
    .insert(horseHealthRecords)
    .values({ ...encrypted, clubId, horseId })
    .returning();
  const row = result[0];
  return row ? decryptFields(row, HEALTH_ENCRYPTED_FIELDS) : row;
}

export async function deleteHealthRecord(clubId: string, horseId: string, recordId: string) {
  const result = await db
    .delete(horseHealthRecords)
    .where(
      and(
        eq(horseHealthRecords.id, recordId),
        eq(horseHealthRecords.clubId, clubId),
        eq(horseHealthRecords.horseId, horseId),
      ),
    )
    .returning({ id: horseHealthRecords.id });
  return result[0] ?? null;
}

// ─── Medications ──────────────────────────────────────────────────────

export async function getMedications(clubId: string, horseId: string, activeOnly = false) {
  const conditions: SQL[] = [
    eq(horseMedications.clubId, clubId),
    eq(horseMedications.horseId, horseId),
  ];

  if (activeOnly) {
    conditions.push(eq(horseMedications.isActive, true));
  }

  const rows = await db
    .select()
    .from(horseMedications)
    .where(and(...conditions))
    .orderBy(desc(horseMedications.createdAt));

  return rows.map((row) => decryptFields(row, MEDICATION_ENCRYPTED_FIELDS));
}

export async function createMedication(clubId: string, horseId: string, data: MedicationCreate) {
  const encrypted = encryptFields(data, MEDICATION_ENCRYPTED_FIELDS);
  const result = await db
    .insert(horseMedications)
    .values({ ...encrypted, clubId, horseId })
    .returning();
  const row = result[0];
  return row ? decryptFields(row, MEDICATION_ENCRYPTED_FIELDS) : row;
}

export async function updateMedication(
  clubId: string,
  horseId: string,
  medicationId: string,
  data: Partial<MedicationCreate>,
) {
  const encrypted = encryptFields(data, MEDICATION_ENCRYPTED_FIELDS);
  const result = await db
    .update(horseMedications)
    .set({ ...encrypted, updatedAt: new Date() })
    .where(
      and(
        eq(horseMedications.id, medicationId),
        eq(horseMedications.clubId, clubId),
        eq(horseMedications.horseId, horseId),
      ),
    )
    .returning();
  const row = result[0];
  return row ? decryptFields(row, MEDICATION_ENCRYPTED_FIELDS) : null;
}

// ─── Medication Logs ──────────────────────────────────────────────────

export async function getMedicationLogs(clubId: string, horseId: string, medicationId: string) {
  return db
    .select()
    .from(horseMedicationLogs)
    .where(
      and(
        eq(horseMedicationLogs.clubId, clubId),
        eq(horseMedicationLogs.horseId, horseId),
        eq(horseMedicationLogs.medicationId, medicationId),
      ),
    )
    .orderBy(desc(horseMedicationLogs.administeredAt));
}

export async function createMedicationLog(clubId: string, horseId: string, data: MedicationLogCreate) {
  const result = await db
    .insert(horseMedicationLogs)
    .values({ ...data, clubId, horseId })
    .returning();
  return result[0];
}

// ─── Feeding Plans ────────────────────────────────────────────────────

export async function getFeedingPlans(clubId: string, horseId: string) {
  return db
    .select()
    .from(horseFeedingPlans)
    .where(and(eq(horseFeedingPlans.clubId, clubId), eq(horseFeedingPlans.horseId, horseId)))
    .orderBy(asc(horseFeedingPlans.timeOfDay));
}

export async function createFeedingPlan(clubId: string, horseId: string, data: FeedingPlanCreate) {
  const values = {
    ...data,
    quantityKg: data.quantityKg != null ? String(data.quantityKg) : null,
    clubId,
    horseId,
  } as NewFeedingPlan;
  const result = await db.insert(horseFeedingPlans).values(values).returning();
  return result[0];
}

export async function updateFeedingPlan(
  clubId: string,
  horseId: string,
  planId: string,
  data: Partial<FeedingPlanCreate>,
) {
  const values = {
    ...data,
    ...(data.quantityKg != null ? { quantityKg: String(data.quantityKg) } : {}),
    updatedAt: new Date(),
  } as Partial<NewFeedingPlan>;
  const result = await db
    .update(horseFeedingPlans)
    .set(values)
    .where(
      and(
        eq(horseFeedingPlans.id, planId),
        eq(horseFeedingPlans.clubId, clubId),
        eq(horseFeedingPlans.horseId, horseId),
      ),
    )
    .returning();
  return result[0] ?? null;
}

export async function deleteFeedingPlan(clubId: string, horseId: string, planId: string) {
  const result = await db
    .delete(horseFeedingPlans)
    .where(
      and(
        eq(horseFeedingPlans.id, planId),
        eq(horseFeedingPlans.clubId, clubId),
        eq(horseFeedingPlans.horseId, horseId),
      ),
    )
    .returning({ id: horseFeedingPlans.id });
  return result[0] ?? null;
}

// ─── Exercise Schedules ───────────────────────────────────────────────

export async function getExerciseSchedules(clubId: string, horseId: string) {
  return db
    .select()
    .from(horseExerciseSchedules)
    .where(and(eq(horseExerciseSchedules.clubId, clubId), eq(horseExerciseSchedules.horseId, horseId)))
    .orderBy(asc(horseExerciseSchedules.dayOfWeek));
}

export async function createExerciseSchedule(clubId: string, horseId: string, data: ExerciseCreate) {
  const result = await db
    .insert(horseExerciseSchedules)
    .values({ ...data, clubId, horseId })
    .returning();
  return result[0];
}

export async function updateExerciseSchedule(
  clubId: string,
  horseId: string,
  scheduleId: string,
  data: Partial<ExerciseCreate>,
) {
  const result = await db
    .update(horseExerciseSchedules)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(horseExerciseSchedules.id, scheduleId),
        eq(horseExerciseSchedules.clubId, clubId),
        eq(horseExerciseSchedules.horseId, horseId),
      ),
    )
    .returning();
  return result[0] ?? null;
}

export async function deleteExerciseSchedule(clubId: string, horseId: string, scheduleId: string) {
  const result = await db
    .delete(horseExerciseSchedules)
    .where(
      and(
        eq(horseExerciseSchedules.id, scheduleId),
        eq(horseExerciseSchedules.clubId, clubId),
        eq(horseExerciseSchedules.horseId, horseId),
      ),
    )
    .returning({ id: horseExerciseSchedules.id });
  return result[0] ?? null;
}

// ─── Documents ────────────────────────────────────────────────────────

export async function getDocuments(clubId: string, horseId: string, category?: string) {
  const conditions: SQL[] = [
    eq(horseDocuments.clubId, clubId),
    eq(horseDocuments.horseId, horseId),
  ];

  if (category) {
    conditions.push(sql`${horseDocuments.category} = ${category}`);
  }

  return db
    .select()
    .from(horseDocuments)
    .where(and(...conditions))
    .orderBy(desc(horseDocuments.createdAt));
}

export async function createDocument(clubId: string, horseId: string, data: DocumentCreate) {
  const result = await db
    .insert(horseDocuments)
    .values({ ...data, clubId, horseId })
    .returning();
  return result[0];
}

export async function deleteDocument(clubId: string, horseId: string, documentId: string) {
  const result = await db
    .delete(horseDocuments)
    .where(
      and(
        eq(horseDocuments.id, documentId),
        eq(horseDocuments.clubId, clubId),
        eq(horseDocuments.horseId, horseId),
      ),
    )
    .returning({ id: horseDocuments.id });
  return result[0] ?? null;
}
