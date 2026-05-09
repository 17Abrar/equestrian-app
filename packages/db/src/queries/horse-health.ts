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

// Audit F-32 (2026-05-07 r5): list-row projections. Each list query
// below selects only the columns the dashboard table consumes, mirroring
// the F-8 (round 4) HorseListItem pattern. PHI fields encrypted at rest
// (`description` / `diagnosis` / `treatment` on health records, `notes`
// on medications) are intentionally OMITTED from list projections —
// list views never need them, and decrypting per-row across a paginated
// list wastes CPU. Detail GETs continue to read + decrypt the full row.

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
// Audit pass-2 (2026-05-09 B-3): added `prescribedBy` to the encrypted
// list. The treating provider's name is HIPAA-style identifying info.
// Schema column widened from varchar(255) to text in migration 0052.
const MEDICATION_ENCRYPTED_FIELDS = ['notes', 'prescribedBy'] as const;

// Audit pass-2 (2026-05-09 B-5): user-typed description on a vet/medical/
// xray-categorised document upload is PHI ("ultrasound on hock", "xray
// shows hairline fracture"). Encrypt at rest.
const HORSE_DOCUMENT_ENCRYPTED_FIELDS = ['description'] as const;

// Audit F-2 (2026-05-08 r6 PR Psi): medication-administration logs are the
// audit trail of what was given, when, and why a dose was skipped.
// `skipReason` ("rider rejected — abscess flared") and `notes` are
// clinical PHI that must not sit plaintext on disk. Migration 0048 ships
// a verifier that aborts forward apply if any post-cutoff row lacks the
// `v1:` prefix; backfill via `scripts/backfill-horse-care-phi.mjs`.
const MEDICATION_LOG_ENCRYPTED_FIELDS = ['notes', 'skipReason'] as const;

// Audit F-3 (2026-05-08 r6 PR Psi): feeding-plan `notes` carry vet/groom-
// prescribed prescriptive content (e.g. "low-protein due to laminitis
// recovery"). A horse's chronic condition is reconstructible from the
// plan even when the corresponding `horse_health_records.diagnosis` is
// encrypted — defense-in-depth gap.
const FEEDING_PLAN_ENCRYPTED_FIELDS = ['notes'] as const;

// Audit F-3 (2026-05-08 r6 PR Psi): exercise-schedule `notes` carry the
// same prescriptive shape as feeding plans (e.g. recovery / rehab notes).
const EXERCISE_SCHEDULE_ENCRYPTED_FIELDS = ['notes'] as const;

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
  // Audit F-32: narrow projection. The list view (health-tab.tsx)
  // renders date/type/title/vetName/cost/followUpNeeded/followUpDate.
  // Encrypted PHI columns (`description`, `diagnosis`, `treatment`)
  // are intentionally omitted — fetch via the detail GET when needed.
  const [rows, count] = await Promise.all([
    db
      .select({
        id: horseHealthRecords.id,
        clubId: horseHealthRecords.clubId,
        horseId: horseHealthRecords.horseId,
        recordType: horseHealthRecords.recordType,
        title: horseHealthRecords.title,
        date: horseHealthRecords.date,
        nextDueDate: horseHealthRecords.nextDueDate,
        vetName: horseHealthRecords.vetName,
        vetClinic: horseHealthRecords.vetClinic,
        cost: horseHealthRecords.cost,
        recoveryTimeDays: horseHealthRecords.recoveryTimeDays,
        followUpNeeded: horseHealthRecords.followUpNeeded,
        followUpDate: horseHealthRecords.followUpDate,
        batchNumber: horseHealthRecords.batchNumber,
        productUsed: horseHealthRecords.productUsed,
        documentUrls: horseHealthRecords.documentUrls,
        createdAt: horseHealthRecords.createdAt,
        updatedAt: horseHealthRecords.updatedAt,
      })
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
    items: rows,
    total: count[0]?.count ?? 0,
  };
}

/**
 * List-row shape for `getHealthRecords` (audit F-32). Encrypted PHI
 * fields (`description`, `diagnosis`, `treatment`) are omitted from
 * the list — consumers that need them must fetch the single record.
 */
export type HealthRecordListItem = Awaited<ReturnType<typeof getHealthRecords>>['items'][number];

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
  // Audit F-32: narrow projection. The list view (health-tab.tsx
  // MedicationsSection) renders medicationName/dosage/frequency/
  // timeOfDay/prescribedBy/isActive. The encrypted PHI column `notes`
  // is intentionally omitted from the list response — list rows never
  // surface it, and decrypting per-row across a paginated list wastes
  // CPU. Detail GETs (currently no caller, but the route exists for
  // future use) would re-add it via a single-row query.
  const [rows, count] = await Promise.all([
    db
      .select({
        id: horseMedications.id,
        clubId: horseMedications.clubId,
        horseId: horseMedications.horseId,
        medicationName: horseMedications.medicationName,
        dosage: horseMedications.dosage,
        frequency: horseMedications.frequency,
        timeOfDay: horseMedications.timeOfDay,
        startDate: horseMedications.startDate,
        endDate: horseMedications.endDate,
        isActive: horseMedications.isActive,
        prescribedBy: horseMedications.prescribedBy,
        createdAt: horseMedications.createdAt,
        updatedAt: horseMedications.updatedAt,
      })
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
    // Audit pass-2 B-3: decrypt `prescribedBy` per row. The list
    // projection above does NOT include `notes` (the original
    // encrypted column) by design — list rows never surface it. But
    // `prescribedBy` IS surfaced on the list (the medications tab
    // renders it inline), so we decrypt per-row here. The cost is one
    // AES-GCM open per row × pageSize; acceptable on a paginated view.
    items: rows.map((row) => decryptFields(row, ['prescribedBy'] as const)),
    total: count[0]?.count ?? 0,
  };
}

/**
 * List-row shape for `getMedications` (audit F-32). Encrypted PHI
 * field `notes` is omitted from the list. `prescribedBy` is included
 * but decrypted at the boundary (audit pass-2 B-3).
 */
export type MedicationListItem = Awaited<ReturnType<typeof getMedications>>['items'][number];

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
  // Audit F-44 (2026-05-08 r6 PR Psi): explicit projection. Was the
  // lone `db.select()` holdout in this file. Keeps the PHI columns
  // (`notes`, `skipReason`) so the consumer sees decrypted values —
  // log entries are the audit trail and the detail view always wants
  // the full row. Decryption happens client-side of the query layer
  // via decryptFields, mirroring the pattern in getMedications.
  const [rows, count] = await Promise.all([
    db
      .select({
        id: horseMedicationLogs.id,
        clubId: horseMedicationLogs.clubId,
        horseId: horseMedicationLogs.horseId,
        medicationId: horseMedicationLogs.medicationId,
        administeredAt: horseMedicationLogs.administeredAt,
        administeredByMemberId: horseMedicationLogs.administeredByMemberId,
        wasAdministered: horseMedicationLogs.wasAdministered,
        skipReason: horseMedicationLogs.skipReason,
        notes: horseMedicationLogs.notes,
        createdAt: horseMedicationLogs.createdAt,
      })
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
  const items = rows.map((row) => decryptFields(row, MEDICATION_LOG_ENCRYPTED_FIELDS));
  return { items, total: count[0]?.count ?? 0 };
}

/** List-row shape for `getMedicationLogs` (audit F-44). */
export type MedicationLogListItem = Awaited<ReturnType<typeof getMedicationLogs>>['items'][number];

export async function createMedicationLog(clubId: string, horseId: string, data: MedicationLogCreate) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
  const encrypted = encryptFields(data, MEDICATION_LOG_ENCRYPTED_FIELDS);
  const result = await db
    .insert(horseMedicationLogs)
    .values({ ...encrypted, clubId, horseId })
    .returning();
  const row = result[0];
  return row ? decryptFields(row, MEDICATION_LOG_ENCRYPTED_FIELDS) : row;
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
  // Audit F-32: explicit projection mirroring feeding-tab.tsx
  // consumption (mealName, feedType, quantityKg, supplements, notes,
  // timeOfDay). No PHI fields here so the projection stays close to
  // the full row, but we still avoid `db.select()` for change-safety
  // and to match the F-8 pattern.
  const [items, count] = await Promise.all([
    db
      .select({
        id: horseFeedingPlans.id,
        clubId: horseFeedingPlans.clubId,
        horseId: horseFeedingPlans.horseId,
        mealName: horseFeedingPlans.mealName,
        feedType: horseFeedingPlans.feedType,
        quantityKg: horseFeedingPlans.quantityKg,
        supplements: horseFeedingPlans.supplements,
        notes: horseFeedingPlans.notes,
        timeOfDay: horseFeedingPlans.timeOfDay,
        createdAt: horseFeedingPlans.createdAt,
        updatedAt: horseFeedingPlans.updatedAt,
      })
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
  // Audit F-3 (2026-05-08 r6 PR Psi): decrypt prescriptive notes on
  // read. Backed by migration 0048 verifier + backfill script.
  const decrypted = items.map((row) => decryptFields(row, FEEDING_PLAN_ENCRYPTED_FIELDS));
  return { items: decrypted, total: count[0]?.count ?? 0 };
}

/** List-row shape for `getFeedingPlans` (audit F-32). */
export type FeedingPlanListItem = Awaited<ReturnType<typeof getFeedingPlans>>['items'][number];

export async function createFeedingPlan(clubId: string, horseId: string, data: FeedingPlanCreate) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
  // Audit F-3 (2026-05-08 r6 PR Psi): encrypt vet/groom-prescribed
  // notes before insert. The double `unknown` cast threads through
  // `encryptFields<T extends Record<string, unknown>>` — interface
  // types like `FeedingPlanCreate` don't carry an index signature,
  // but the helper only touches the named string fields.
  const encrypted = encryptFields(
    data as unknown as Record<string, unknown>,
    FEEDING_PLAN_ENCRYPTED_FIELDS as readonly string[],
  ) as unknown as FeedingPlanCreate;
  const values = {
    ...encrypted,
    quantityKg: encrypted.quantityKg != null ? String(encrypted.quantityKg) : null,
    clubId,
    horseId,
  } as NewFeedingPlan;
  const result = await db.insert(horseFeedingPlans).values(values).returning();
  const row = result[0];
  return row ? decryptFields(row, FEEDING_PLAN_ENCRYPTED_FIELDS) : row;
}

export async function updateFeedingPlan(
  clubId: string,
  horseId: string,
  planId: string,
  data: Partial<FeedingPlanCreate>,
) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
  // Audit F-3 (2026-05-08 r6 PR Psi): partial-update encryption —
  // `encryptFields` skips `undefined` so untouched fields are not
  // overwritten. An explicit `null` clears the column (handled by the
  // helper as null pass-through).
  const encrypted = encryptFields(
    data as unknown as Record<string, unknown>,
    FEEDING_PLAN_ENCRYPTED_FIELDS as readonly string[],
  ) as unknown as Partial<FeedingPlanCreate>;
  const values = {
    ...encrypted,
    ...(encrypted.quantityKg != null ? { quantityKg: String(encrypted.quantityKg) } : {}),
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
  const row = result[0];
  return row ? decryptFields(row, FEEDING_PLAN_ENCRYPTED_FIELDS) : null;
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
  // Audit F-32: explicit projection mirroring exercise-tab.tsx
  // consumption.
  const [items, count] = await Promise.all([
    db
      .select({
        id: horseExerciseSchedules.id,
        clubId: horseExerciseSchedules.clubId,
        horseId: horseExerciseSchedules.horseId,
        dayOfWeek: horseExerciseSchedules.dayOfWeek,
        exerciseType: horseExerciseSchedules.exerciseType,
        durationMinutes: horseExerciseSchedules.durationMinutes,
        intensity: horseExerciseSchedules.intensity,
        notes: horseExerciseSchedules.notes,
        createdAt: horseExerciseSchedules.createdAt,
        updatedAt: horseExerciseSchedules.updatedAt,
      })
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
  // Audit F-3 (2026-05-08 r6 PR Psi): decrypt rehab/recovery notes
  // on read. Backed by migration 0048 verifier + backfill script.
  const decrypted = items.map((row) => decryptFields(row, EXERCISE_SCHEDULE_ENCRYPTED_FIELDS));
  return { items: decrypted, total: count[0]?.count ?? 0 };
}

/** List-row shape for `getExerciseSchedules` (audit F-32). */
export type ExerciseScheduleListItem = Awaited<ReturnType<typeof getExerciseSchedules>>['items'][number];

export async function createExerciseSchedule(clubId: string, horseId: string, data: ExerciseCreate) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
  const encrypted = encryptFields(data, EXERCISE_SCHEDULE_ENCRYPTED_FIELDS);
  const result = await db
    .insert(horseExerciseSchedules)
    .values({ ...encrypted, clubId, horseId })
    .returning();
  const row = result[0];
  return row ? decryptFields(row, EXERCISE_SCHEDULE_ENCRYPTED_FIELDS) : row;
}

export async function updateExerciseSchedule(
  clubId: string,
  horseId: string,
  scheduleId: string,
  data: Partial<ExerciseCreate>,
) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
  const encrypted = encryptFields(data, EXERCISE_SCHEDULE_ENCRYPTED_FIELDS);
  const result = await db
    .update(horseExerciseSchedules)
    .set({ ...encrypted, updatedAt: new Date() })
    .where(
      and(
        eq(horseExerciseSchedules.id, scheduleId),
        eq(horseExerciseSchedules.clubId, clubId),
        eq(horseExerciseSchedules.horseId, horseId),
      ),
    )
    .returning();
  const row = result[0];
  return row ? decryptFields(row, EXERCISE_SCHEDULE_ENCRYPTED_FIELDS) : null;
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
  // Audit F-32: explicit projection mirroring documents-tab.tsx
  // (fileName, fileUrl, fileType, category, description).
  const [items, count] = await Promise.all([
    db
      .select({
        id: horseDocuments.id,
        clubId: horseDocuments.clubId,
        horseId: horseDocuments.horseId,
        fileName: horseDocuments.fileName,
        fileUrl: horseDocuments.fileUrl,
        fileSizeBytes: horseDocuments.fileSizeBytes,
        fileType: horseDocuments.fileType,
        category: horseDocuments.category,
        description: horseDocuments.description,
        uploadedByMemberId: horseDocuments.uploadedByMemberId,
        createdAt: horseDocuments.createdAt,
      })
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
  return {
    // Audit pass-2 B-5: decrypt `description` per row. medical/vet/xray
    // categories collect descriptions like "ultrasound on hock" which is
    // PHI; encryption-at-rest closes the disk-leak surface.
    items: items.map((row) => decryptFields(row, HORSE_DOCUMENT_ENCRYPTED_FIELDS)),
    total: count[0]?.count ?? 0,
  };
}

/** List-row shape for `getDocuments` (audit F-32). */
export type HorseDocumentListItem = Awaited<ReturnType<typeof getDocuments>>['items'][number];

export async function createDocument(clubId: string, horseId: string, data: DocumentCreate) {
  if (!(await isHorseActiveInClub(clubId, horseId))) return null;
  // Audit pass-2 B-5: encrypt `description` before write.
  const encrypted = encryptFields(data, HORSE_DOCUMENT_ENCRYPTED_FIELDS);
  const result = await db
    .insert(horseDocuments)
    .values({ ...data, ...encrypted, clubId, horseId })
    .returning();
  const row = result[0];
  return row ? decryptFields(row, HORSE_DOCUMENT_ENCRYPTED_FIELDS) : row;
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
    // Audit pass-2 B-2: drop the vet name from the email payload —
    // Resend stores email bodies in their logs and `detail` was the
    // PII vector. The reminder still tells the recipient WHICH horse
    // and WHEN; the dashboard link covers the rest.
    detail: null,
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
    // Audit pass-2 B-2: title + vetName are PHI/PII; don't carry them
    // into Resend's email logs.
    detail: null,
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
    // Audit pass-2 B-2: insurance provider + policy number are PII;
    // a leak of those into Resend's email logs is the same kind of
    // disclosure the encryption-at-rest sweep is closing. Recipient
    // looks them up in the dashboard.
    detail: null,
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
    // Audit pass-2 B-2: medication name + dosage IS the PHI we encrypt
    // at rest on `horse_medications`. Don't unencrypt it back into
    // Resend's email logs — recipient opens the horse profile.
    detail: null,
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

/**
 * Audit pass-2 (2026-05-09 C-2): companion to
 * `recordHorseCareReminderSend`. Deletes the dedup row when the email
 * send fails, so the next cron pass can re-attempt instead of being
 * permanently silenced. Mirrors `unmarkBookingReminderSent`. Safe
 * under concurrency: a delete that targets a row another isolate
 * already processed is a no-op (returns zero rows).
 */
export async function unrecordHorseCareReminderSend(args: {
  clubId: string;
  kind: string;
  sourceId: string;
  thresholdDays: number;
}): Promise<void> {
  await rawDb
    .delete(horseCareReminderSends)
    .where(
      and(
        eq(horseCareReminderSends.clubId, args.clubId),
        eq(horseCareReminderSends.kind, args.kind),
        eq(horseCareReminderSends.sourceId, args.sourceId),
        eq(horseCareReminderSends.thresholdDays, args.thresholdDays),
      ),
    );
}

function humanizeCareLabel(recordType: string, _title: string): string {
  // Audit pass-2 (2026-05-09 B-2): the previous implementation fell
  // back to the user-typed `title` for unknown recordTypes. Titles
  // are freeform PHI ("Ultrasound on left front fetlock") and ended
  // up in Resend's email-body logs once the cron sent. Stay on the
  // category map — anything unknown collapses to a generic "Routine
  // care". The `_title` parameter is kept for callsite back-compat;
  // the underscore prefix flags it as intentionally unused.
  const map: Record<string, string> = {
    vaccination: 'Vaccination',
    farrier: 'Farrier visit',
    dental: 'Dental visit',
    deworming: 'Deworming',
    checkup: 'Checkup',
    teeth_floating: 'Teeth floating',
  };
  return map[recordType] ?? 'Routine care';
}

function addIsoDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
