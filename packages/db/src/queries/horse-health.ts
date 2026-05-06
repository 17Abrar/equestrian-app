import { eq, and, asc, desc, gte, isNull, lte, sql, SQL } from 'drizzle-orm';
import { db, rawDb } from '../index';
import {
  horseHealthRecords,
  horseMedications,
  horseMedicationLogs,
  horseFeedingPlans,
  horseExerciseSchedules,
  horseDocuments,
  horseCareReminderSends,
} from '../schema/horse-health';
import { horses } from '../schema/horses';
import { clubs } from '../schema/clubs';
import { decryptFields, encryptFields } from '../crypto';

/**
 * Soft-delete gate for every read/write in this file (audit AI-22 / KP-1).
 * After softDeleteHorse, the horse_health_records / medications / etc. rows
 * remain on disk but must not be reachable via any horse-scoped GET or POST
 * — the buyer of a transferred horse, or a GDPR-style deletion request,
 * would otherwise see medical history surface in the new owner's UI.
 *
 * Returns true if the parent horse exists, belongs to this club, and is
 * not soft-deleted; false otherwise. Read functions that join `horses`
 * directly (with the same predicate) don't need this — write functions do.
 */
async function isHorseActiveInClub(clubId: string, horseId: string): Promise<boolean> {
  const rows = await db
    .select({ id: horses.id })
    .from(horses)
    .where(
      and(
        eq(horses.id, horseId),
        eq(horses.clubId, clubId),
        isNull(horses.deletedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

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

export async function getHealthRecords(
  clubId: string,
  horseId: string,
  recordType: string | undefined,
  { page, pageSize }: { page: number; pageSize: number },
) {
  // Soft-delete gate (audit AI-22). Returns empty rather than null so
  // route handlers don't need to special-case the deleted-horse path.
  if (!(await isHorseActiveInClub(clubId, horseId))) return { items: [], total: 0 };

  const conditions: SQL[] = [
    eq(horseHealthRecords.clubId, clubId),
    eq(horseHealthRecords.horseId, horseId),
  ];

  if (recordType) {
    conditions.push(sql`${horseHealthRecords.recordType} = ${recordType}`);
  }

  const where = and(...conditions);
  const offset = (page - 1) * pageSize;
  const [rows, count] = await Promise.all([
    db
      .select()
      .from(horseHealthRecords)
      .where(where)
      .orderBy(desc(horseHealthRecords.date))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(horseHealthRecords)
      .where(where),
  ]);

  return {
    items: rows.map((row) => decryptFields(row, HEALTH_ENCRYPTED_FIELDS)),
    total: count[0]?.count ?? 0,
  };
}

export async function createHealthRecord(clubId: string, horseId: string, data: HealthRecordCreate) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
  const encrypted = encryptFields(data, HEALTH_ENCRYPTED_FIELDS);
  const result = await db
    .insert(horseHealthRecords)
    .values({ ...encrypted, clubId, horseId })
    .returning();
  const row = result[0];
  return row ? decryptFields(row, HEALTH_ENCRYPTED_FIELDS) : row;
}

export async function deleteHealthRecord(clubId: string, horseId: string, recordId: string) {
  // No soft-delete gate here — admins must still be able to remove records
  // from soft-deleted horses (e.g. correcting a wrongly-attributed entry
  // before the horse row itself is purged).
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

export async function getMedications(
  clubId: string,
  horseId: string,
  activeOnly: boolean,
  { page, pageSize }: { page: number; pageSize: number },
) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return { items: [], total: 0 };

  const conditions: SQL[] = [
    eq(horseMedications.clubId, clubId),
    eq(horseMedications.horseId, horseId),
  ];

  if (activeOnly) {
    conditions.push(eq(horseMedications.isActive, true));
  }

  const where = and(...conditions);
  const offset = (page - 1) * pageSize;
  const [rows, count] = await Promise.all([
    db
      .select()
      .from(horseMedications)
      .where(where)
      .orderBy(desc(horseMedications.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(horseMedications)
      .where(where),
  ]);

  return {
    items: rows.map((row) => decryptFields(row, MEDICATION_ENCRYPTED_FIELDS)),
    total: count[0]?.count ?? 0,
  };
}

export async function createMedication(clubId: string, horseId: string, data: MedicationCreate) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
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
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
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

/**
 * Returns the medication if (clubId, horseId, medicationId) all match a single
 * row, else null. Lightweight existence check — used by the logs route to bind
 * a write request's path params to the caller's tenant before insert. The
 * underlying FKs only reference single columns (horses(id), horse_medications(id)),
 * so this is the only place enforcing "this medication is on this horse in this
 * club".
 */
export async function getMedicationByIds(clubId: string, horseId: string, medicationId: string) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
  const result = await db
    .select({ id: horseMedications.id })
    .from(horseMedications)
    .where(
      and(
        eq(horseMedications.id, medicationId),
        eq(horseMedications.clubId, clubId),
        eq(horseMedications.horseId, horseId),
      ),
    )
    .limit(1);
  return result[0] ?? null;
}

export async function getMedicationLogs(
  clubId: string,
  horseId: string,
  medicationId: string,
  { page, pageSize }: { page: number; pageSize: number },
) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return { items: [], total: 0 };
  const where = and(
    eq(horseMedicationLogs.clubId, clubId),
    eq(horseMedicationLogs.horseId, horseId),
    eq(horseMedicationLogs.medicationId, medicationId),
  );
  const offset = (page - 1) * pageSize;
  const [items, count] = await Promise.all([
    db
      .select()
      .from(horseMedicationLogs)
      .where(where)
      .orderBy(desc(horseMedicationLogs.administeredAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(horseMedicationLogs)
      .where(where),
  ]);
  return { items, total: count[0]?.count ?? 0 };
}

export async function createMedicationLog(clubId: string, horseId: string, data: MedicationLogCreate) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
  const result = await db
    .insert(horseMedicationLogs)
    .values({ ...data, clubId, horseId })
    .returning();
  return result[0];
}

// ─── Feeding Plans ────────────────────────────────────────────────────

export async function getFeedingPlans(
  clubId: string,
  horseId: string,
  { page, pageSize }: { page: number; pageSize: number },
) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return { items: [], total: 0 };
  const where = and(
    eq(horseFeedingPlans.clubId, clubId),
    eq(horseFeedingPlans.horseId, horseId),
  );
  const offset = (page - 1) * pageSize;
  const [items, count] = await Promise.all([
    db
      .select()
      .from(horseFeedingPlans)
      .where(where)
      .orderBy(asc(horseFeedingPlans.timeOfDay))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(horseFeedingPlans)
      .where(where),
  ]);
  return { items, total: count[0]?.count ?? 0 };
}

export async function createFeedingPlan(clubId: string, horseId: string, data: FeedingPlanCreate) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
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
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
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
  // Allow deletes against soft-deleted horses (admin cleanup pre-purge).
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

export async function getExerciseSchedules(
  clubId: string,
  horseId: string,
  { page, pageSize }: { page: number; pageSize: number },
) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return { items: [], total: 0 };
  const where = and(
    eq(horseExerciseSchedules.clubId, clubId),
    eq(horseExerciseSchedules.horseId, horseId),
  );
  const offset = (page - 1) * pageSize;
  const [items, count] = await Promise.all([
    db
      .select()
      .from(horseExerciseSchedules)
      .where(where)
      .orderBy(asc(horseExerciseSchedules.dayOfWeek))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(horseExerciseSchedules)
      .where(where),
  ]);
  return { items, total: count[0]?.count ?? 0 };
}

export async function createExerciseSchedule(clubId: string, horseId: string, data: ExerciseCreate) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
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
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
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
  // Allow deletes against soft-deleted horses (admin cleanup pre-purge).
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

export async function getDocuments(
  clubId: string,
  horseId: string,
  category: string | undefined,
  { page, pageSize }: { page: number; pageSize: number },
) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return { items: [], total: 0 };

  const conditions: SQL[] = [
    eq(horseDocuments.clubId, clubId),
    eq(horseDocuments.horseId, horseId),
  ];

  if (category) {
    conditions.push(sql`${horseDocuments.category} = ${category}`);
  }

  const where = and(...conditions);
  const offset = (page - 1) * pageSize;
  const [items, count] = await Promise.all([
    db
      .select()
      .from(horseDocuments)
      .where(where)
      .orderBy(desc(horseDocuments.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(horseDocuments)
      .where(where),
  ]);
  return { items, total: count[0]?.count ?? 0 };
}

export async function createDocument(clubId: string, horseId: string, data: DocumentCreate) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
  const result = await db
    .insert(horseDocuments)
    .values({ ...data, clubId, horseId })
    .returning();
  return result[0];
}

export async function deleteDocument(clubId: string, horseId: string, documentId: string) {
  // Allow deletes against soft-deleted horses (admin cleanup pre-purge).
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

// ─── Round 6.2 — care reminder cron helpers ──────────────────────────
//
// Four sources, one dedup table. Every cron tick joins the source with
// `clubs` (for tz/name/email) and `horses` (for the horse name + club
// scope) and excludes soft-deleted horses + the dedup row for the
// (kind, source_id, threshold) tuple. The cron then sends emails and
// stamps a row into `horse_care_reminder_sends` per successful send.
//
// `today` is passed as a YYYY-MM-DD string so the queries compare
// `date` columns without driver coercion. The cron resolves the
// per-club timezone-aware "today" outside this layer, same as the
// platform-billing reminder helpers.

export interface CareReminderCandidate {
  /** Source row id (horse_health_records.id, horses.id, or
   *  horse_medications.id depending on `kind`). The cron uses this as
   *  the dedup key. */
  sourceId: string;
  clubId: string;
  clubName: string;
  clubEmail: string | null;
  clubTimezone: string;
  clubLogoUrl: string | null;
  horseId: string;
  horseName: string;
  /** YYYY-MM-DD — the underlying due/follow-up/expiry/end date. */
  dueDate: string;
  /** Pre-rendered care label for the email — populated per-source. */
  careTypeLabel: string;
  /** Free-form detail for the email's detail row (medication name +
   *  dosage, vet name, insurance provider, etc). May be undefined. */
  detail: string | null;
}

export interface CareReminderQueryArgs {
  todayIso: string;
  /** Look-ahead window (inclusive). The cron passes the largest
   *  threshold (e.g. 30 for insurance) to fetch every row whose due
   *  date is at most that many days out. */
  lookAheadDays: number;
}

export async function findUpcomingHealthRecordDueDates(
  args: CareReminderQueryArgs,
): Promise<CareReminderCandidate[]> {
  const cutoff = addIsoDays(args.todayIso, args.lookAheadDays);
  const rows = await rawDb
    .select({
      sourceId: horseHealthRecords.id,
      clubId: horseHealthRecords.clubId,
      clubName: clubs.name,
      clubEmail: clubs.email,
      clubTimezone: clubs.timezone,
      clubLogoUrl: clubs.logoUrl,
      horseId: horseHealthRecords.horseId,
      horseName: horses.name,
      dueDate: horseHealthRecords.nextDueDate,
      recordType: horseHealthRecords.recordType,
      title: horseHealthRecords.title,
      vetName: horseHealthRecords.vetName,
    })
    .from(horseHealthRecords)
    .innerJoin(
      horses,
      and(
        eq(horses.id, horseHealthRecords.horseId),
        eq(horses.clubId, horseHealthRecords.clubId),
        isNull(horses.deletedAt),
      ),
    )
    .innerJoin(clubs, and(eq(clubs.id, horseHealthRecords.clubId), isNull(clubs.deletedAt)))
    .where(
      and(
        sql`${horseHealthRecords.nextDueDate} IS NOT NULL`,
        lte(horseHealthRecords.nextDueDate, cutoff),
      ),
    )
    .limit(500);
  return rows.map((r) => ({
    sourceId: r.sourceId,
    clubId: r.clubId,
    clubName: r.clubName,
    clubEmail: r.clubEmail,
    clubTimezone: r.clubTimezone,
    clubLogoUrl: r.clubLogoUrl,
    horseId: r.horseId,
    horseName: r.horseName,
    dueDate: r.dueDate as string,
    careTypeLabel: humanizeCareLabel(r.recordType, r.title),
    detail: r.vetName,
  }));
}

export async function findUpcomingHealthRecordFollowUps(
  args: CareReminderQueryArgs,
): Promise<CareReminderCandidate[]> {
  const cutoff = addIsoDays(args.todayIso, args.lookAheadDays);
  const rows = await rawDb
    .select({
      sourceId: horseHealthRecords.id,
      clubId: horseHealthRecords.clubId,
      clubName: clubs.name,
      clubEmail: clubs.email,
      clubTimezone: clubs.timezone,
      clubLogoUrl: clubs.logoUrl,
      horseId: horseHealthRecords.horseId,
      horseName: horses.name,
      dueDate: horseHealthRecords.followUpDate,
      title: horseHealthRecords.title,
      vetName: horseHealthRecords.vetName,
    })
    .from(horseHealthRecords)
    .innerJoin(
      horses,
      and(
        eq(horses.id, horseHealthRecords.horseId),
        eq(horses.clubId, horseHealthRecords.clubId),
        isNull(horses.deletedAt),
      ),
    )
    .innerJoin(clubs, and(eq(clubs.id, horseHealthRecords.clubId), isNull(clubs.deletedAt)))
    .where(
      and(
        eq(horseHealthRecords.followUpNeeded, true),
        sql`${horseHealthRecords.followUpDate} IS NOT NULL`,
        lte(horseHealthRecords.followUpDate, cutoff),
      ),
    )
    .limit(500);
  return rows.map((r) => ({
    sourceId: r.sourceId,
    clubId: r.clubId,
    clubName: r.clubName,
    clubEmail: r.clubEmail,
    clubTimezone: r.clubTimezone,
    clubLogoUrl: r.clubLogoUrl,
    horseId: r.horseId,
    horseName: r.horseName,
    dueDate: r.dueDate as string,
    careTypeLabel: 'Vet follow-up',
    detail: r.vetName ? `Follow-up to: ${r.title} (${r.vetName})` : `Follow-up to: ${r.title}`,
  }));
}

export async function findUpcomingHorseInsuranceExpiries(
  args: CareReminderQueryArgs,
): Promise<CareReminderCandidate[]> {
  const cutoff = addIsoDays(args.todayIso, args.lookAheadDays);
  const rows = await rawDb
    .select({
      sourceId: horses.id,
      clubId: horses.clubId,
      clubName: clubs.name,
      clubEmail: clubs.email,
      clubTimezone: clubs.timezone,
      clubLogoUrl: clubs.logoUrl,
      horseId: horses.id,
      horseName: horses.name,
      dueDate: horses.insuranceExpiry,
      insuranceProvider: horses.insuranceProvider,
      insurancePolicyNumber: horses.insurancePolicyNumber,
    })
    .from(horses)
    .innerJoin(clubs, and(eq(clubs.id, horses.clubId), isNull(clubs.deletedAt)))
    .where(
      and(
        sql`${horses.insuranceExpiry} IS NOT NULL`,
        lte(horses.insuranceExpiry, cutoff),
        isNull(horses.deletedAt),
      ),
    )
    .limit(500);
  return rows.map((r) => ({
    sourceId: r.sourceId,
    clubId: r.clubId,
    clubName: r.clubName,
    clubEmail: r.clubEmail,
    clubTimezone: r.clubTimezone,
    clubLogoUrl: r.clubLogoUrl,
    horseId: r.horseId,
    horseName: r.horseName,
    dueDate: r.dueDate as string,
    careTypeLabel: 'Insurance renewal',
    detail: r.insuranceProvider
      ? r.insurancePolicyNumber
        ? `${r.insuranceProvider} (policy ${r.insurancePolicyNumber})`
        : r.insuranceProvider
      : null,
  }));
}

export async function findUpcomingMedicationEnds(
  args: CareReminderQueryArgs,
): Promise<CareReminderCandidate[]> {
  const cutoff = addIsoDays(args.todayIso, args.lookAheadDays);
  const rows = await rawDb
    .select({
      sourceId: horseMedications.id,
      clubId: horseMedications.clubId,
      clubName: clubs.name,
      clubEmail: clubs.email,
      clubTimezone: clubs.timezone,
      clubLogoUrl: clubs.logoUrl,
      horseId: horseMedications.horseId,
      horseName: horses.name,
      dueDate: horseMedications.endDate,
      medicationName: horseMedications.medicationName,
      dosage: horseMedications.dosage,
    })
    .from(horseMedications)
    .innerJoin(
      horses,
      and(
        eq(horses.id, horseMedications.horseId),
        eq(horses.clubId, horseMedications.clubId),
        isNull(horses.deletedAt),
      ),
    )
    .innerJoin(clubs, and(eq(clubs.id, horseMedications.clubId), isNull(clubs.deletedAt)))
    .where(
      and(
        eq(horseMedications.isActive, true),
        sql`${horseMedications.endDate} IS NOT NULL`,
        lte(horseMedications.endDate, cutoff),
        // Don't bother with end-dates that have already long passed —
        // a stale active=true row that nobody zeroed out shouldn't
        // continue to ping the team forever.
        gte(horseMedications.endDate, addIsoDays(args.todayIso, -7)),
      ),
    )
    .limit(500);
  return rows.map((r) => ({
    sourceId: r.sourceId,
    clubId: r.clubId,
    clubName: r.clubName,
    clubEmail: r.clubEmail,
    clubTimezone: r.clubTimezone,
    clubLogoUrl: r.clubLogoUrl,
    horseId: r.horseId,
    horseName: r.horseName,
    dueDate: r.dueDate as string,
    careTypeLabel: 'Medication ending',
    detail: `${r.medicationName} — ${r.dosage}`,
  }));
}

/**
 * Idempotent reminder-send recorder. Returns true on a fresh INSERT
 * (caller should send the email) and false when the unique constraint
 * already has a row (caller skips). Concurrent crons that win the same
 * (kind, source_id, threshold_days) tuple resolve cleanly via the
 * `ON CONFLICT DO NOTHING` clause.
 */
export async function recordHorseCareReminderSend(args: {
  clubId: string;
  kind: string;
  sourceId: string;
  thresholdDays: number;
}): Promise<boolean> {
  const inserted = await rawDb
    .insert(horseCareReminderSends)
    .values({
      clubId: args.clubId,
      kind: args.kind,
      sourceId: args.sourceId,
      thresholdDays: args.thresholdDays,
    })
    .onConflictDoNothing({
      target: [
        horseCareReminderSends.clubId,
        horseCareReminderSends.kind,
        horseCareReminderSends.sourceId,
        horseCareReminderSends.thresholdDays,
      ],
    })
    .returning({ id: horseCareReminderSends.id });
  return inserted.length > 0;
}

function humanizeCareLabel(recordType: string, title: string): string {
  // Fallback to title when the type slug is empty / unknown — a hand-
  // entered "Vaccination" title is more useful than the literal slug.
  const map: Record<string, string> = {
    vaccination: 'Vaccination',
    farrier: 'Farrier visit',
    dental: 'Dental visit',
    deworming: 'Deworming',
    checkup: 'Checkup',
    teeth_floating: 'Teeth floating',
  };
  if (recordType in map) {
    return map[recordType] ?? title;
  }
  return title || 'Routine care';
}

function addIsoDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
