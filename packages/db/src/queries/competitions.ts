import { eq, and, asc, desc, sql, SQL } from 'drizzle-orm';
import { db } from '../index';
import {
  competitions,
  competitionClasses,
  competitionEntries,
  competitionResults,
} from '../schema/competitions';
import { clubMembers } from '../schema/club-members';
import { horses } from '../schema/horses';

// ─── Types ────────────────────────────────────────────────────────────

type NewCompetition = typeof competitions.$inferInsert;
type DrizzleCompetitionCreate = Omit<NewCompetition, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>;

/** Accepts strings for date/timestamp fields from Zod — converts for Drizzle */
interface CompetitionCreate extends Omit<DrizzleCompetitionCreate, 'registrationDeadline'> {
  registrationDeadline?: string | Date | null;
}
type CompetitionUpdate = Partial<CompetitionCreate>;

function toCompetitionValues(data: CompetitionCreate | CompetitionUpdate): Record<string, unknown> {
  const result = { ...data };
  if (typeof result.registrationDeadline === 'string') {
    result.registrationDeadline = new Date(result.registrationDeadline);
  }
  return result;
}

type NewClass = typeof competitionClasses.$inferInsert;
type ClassCreate = Omit<NewClass, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>;
type ClassUpdate = Partial<Omit<ClassCreate, 'competitionId'>>;

type NewEntry = typeof competitionEntries.$inferInsert;
type EntryCreate = Omit<NewEntry, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>;

type NewResult = typeof competitionResults.$inferInsert;
type DrizzleResultCreate = Omit<NewResult, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>;

/** Accepts number for timeSeconds from Zod — converts to string for Drizzle numeric column */
interface ResultCreate extends Omit<DrizzleResultCreate, 'timeSeconds'> {
  timeSeconds?: number | string | null;
}

interface CompetitionFilters {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
}

// ─── Competitions ─────────────────────────────────────────────────────

export async function getCompetitionsByClub(clubId: string, filters: CompetitionFilters) {
  const conditions: SQL[] = [
    eq(competitions.clubId, clubId),
    eq(competitions.isActive, true),
  ];

  if (filters.status) {
    conditions.push(sql`${competitions.status} = ${filters.status}`);
  }

  if (filters.dateFrom) {
    conditions.push(sql`${competitions.startDate} >= ${filters.dateFrom}`);
  }

  if (filters.dateTo) {
    conditions.push(sql`${competitions.endDate} <= ${filters.dateTo}`);
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  const [data, countResult] = await Promise.all([
    db
      .select({
        id: competitions.id,
        clubId: competitions.clubId,
        name: competitions.name,
        description: competitions.description,
        startDate: competitions.startDate,
        endDate: competitions.endDate,
        location: competitions.location,
        disciplines: competitions.disciplines,
        entryFee: competitions.entryFee,
        currency: competitions.currency,
        registrationDeadline: competitions.registrationDeadline,
        maxParticipants: competitions.maxParticipants,
        status: competitions.status,
        createdAt: competitions.createdAt,
      })
      .from(competitions)
      .where(where)
      .orderBy(desc(competitions.startDate))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(competitions)
      .where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}

export async function getCompetitionById(clubId: string, competitionId: string) {
  const result = await db
    .select()
    .from(competitions)
    .where(
      and(
        eq(competitions.id, competitionId),
        eq(competitions.clubId, clubId),
        eq(competitions.isActive, true),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}

export async function createCompetition(clubId: string, data: CompetitionCreate) {
  const values = { ...toCompetitionValues(data), clubId } as NewCompetition;
  const result = await db.insert(competitions).values(values).returning();
  return result[0];
}

export async function updateCompetition(clubId: string, competitionId: string, data: CompetitionUpdate) {
  const values = { ...toCompetitionValues(data), updatedAt: new Date() } as Partial<NewCompetition>;
  const result = await db
    .update(competitions)
    .set(values)
    .where(and(eq(competitions.id, competitionId), eq(competitions.clubId, clubId)))
    .returning();
  return result[0] ?? null;
}

export async function deleteCompetition(clubId: string, competitionId: string) {
  const result = await db
    .update(competitions)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(competitions.id, competitionId), eq(competitions.clubId, clubId)))
    .returning({ id: competitions.id });
  return result[0] ?? null;
}

// ─── Competition Classes ──────────────────────────────────────────────

export async function getCompetitionClasses(clubId: string, competitionId: string) {
  return db
    .select()
    .from(competitionClasses)
    .where(
      and(
        eq(competitionClasses.clubId, clubId),
        eq(competitionClasses.competitionId, competitionId),
      ),
    )
    .orderBy(asc(competitionClasses.sortOrder), asc(competitionClasses.name));
}

export async function createCompetitionClass(clubId: string, data: ClassCreate) {
  const result = await db.insert(competitionClasses).values({ ...data, clubId }).returning();
  return result[0];
}

export async function updateCompetitionClass(clubId: string, classId: string, data: ClassUpdate) {
  const result = await db
    .update(competitionClasses)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(competitionClasses.id, classId), eq(competitionClasses.clubId, clubId)))
    .returning();
  return result[0] ?? null;
}

export async function deleteCompetitionClass(clubId: string, classId: string) {
  const result = await db
    .delete(competitionClasses)
    .where(and(eq(competitionClasses.id, classId), eq(competitionClasses.clubId, clubId)))
    .returning({ id: competitionClasses.id });
  return result[0] ?? null;
}

// ─── Competition Entries ──────────────────────────────────────────────

export async function getCompetitionEntries(clubId: string, classId: string) {
  return db
    .select({
      id: competitionEntries.id,
      classId: competitionEntries.classId,
      riderMemberId: competitionEntries.riderMemberId,
      horseId: competitionEntries.horseId,
      status: competitionEntries.status,
      paymentStatus: competitionEntries.paymentStatus,
      amount: competitionEntries.amount,
      currency: competitionEntries.currency,
      registeredAt: competitionEntries.registeredAt,
      riderName: clubMembers.displayName,
      horseName: horses.name,
    })
    .from(competitionEntries)
    .innerJoin(clubMembers, eq(competitionEntries.riderMemberId, clubMembers.id))
    .leftJoin(horses, eq(competitionEntries.horseId, horses.id))
    .where(
      and(
        eq(competitionEntries.clubId, clubId),
        eq(competitionEntries.classId, classId),
      ),
    )
    .orderBy(asc(competitionEntries.registeredAt));
}

/**
 * Atomically creates a competition entry after verifying:
 * 1. Registration deadline has not passed
 * 2. Class is not full (max entries not exceeded)
 * Must be called inside `runInTenantContext`.
 */
export async function createCompetitionEntry(clubId: string, data: EntryCreate) {
  return db.transaction(async (tx) => {
    // Acquire a row-level lock on the class so concurrent entry attempts for
    // the same class serialize rather than racing past the capacity check.
    // Without this, two parallel requests could both see `count < max` and
    // both insert, blowing past `maxEntries`.
    const classRow = await tx
      .select({
        id: competitionClasses.id,
        maxEntries: competitionClasses.maxEntries,
        competitionId: competitionClasses.competitionId,
      })
      .from(competitionClasses)
      .where(
        and(
          eq(competitionClasses.id, data.classId),
          eq(competitionClasses.clubId, clubId),
        ),
      )
      .for('update')
      .limit(1);

    const cls = classRow[0];
    if (!cls) {
      throw new Error('CLASS_NOT_FOUND');
    }

    // Check registration deadline
    const comp = await tx
      .select({ registrationDeadline: competitions.registrationDeadline, status: competitions.status })
      .from(competitions)
      .where(eq(competitions.id, cls.competitionId))
      .limit(1);

    const competition = comp[0];
    if (!competition || competition.status === 'cancelled') {
      throw new Error('COMPETITION_NOT_AVAILABLE');
    }

    if (competition.registrationDeadline && new Date() > competition.registrationDeadline) {
      throw new Error('REGISTRATION_DEADLINE_PASSED');
    }

    // Check capacity
    if (cls.maxEntries) {
      const countResult = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(competitionEntries)
        .where(
          and(
            eq(competitionEntries.clubId, clubId),
            eq(competitionEntries.classId, data.classId),
            sql`${competitionEntries.status} != 'withdrawn'`,
            sql`${competitionEntries.status} != 'scratched'`,
          ),
        );

      const currentEntries = countResult[0]?.count ?? 0;
      if (currentEntries >= cls.maxEntries) {
        throw new Error('CLASS_FULL');
      }
    }

    const result = await tx
      .insert(competitionEntries)
      .values({ ...data, clubId })
      .returning();

    return result[0];
  });
}

export async function withdrawCompetitionEntry(
  clubId: string,
  entryId: string,
  reason: string,
) {
  const result = await db
    .update(competitionEntries)
    .set({
      status: 'withdrawn',
      withdrawnAt: new Date(),
      withdrawalReason: reason,
      updatedAt: new Date(),
    })
    .where(and(eq(competitionEntries.id, entryId), eq(competitionEntries.clubId, clubId)))
    .returning();
  return result[0] ?? null;
}

// ─── Competition Results ──────────────────────────────────────────────

export async function getCompetitionResults(clubId: string, classId: string) {
  return db
    .select({
      id: competitionResults.id,
      entryId: competitionResults.entryId,
      placing: competitionResults.placing,
      timeSeconds: competitionResults.timeSeconds,
      faults: competitionResults.faults,
      notes: competitionResults.notes,
      riderName: clubMembers.displayName,
      horseName: horses.name,
    })
    .from(competitionResults)
    .innerJoin(competitionEntries, eq(competitionResults.entryId, competitionEntries.id))
    .innerJoin(clubMembers, eq(competitionEntries.riderMemberId, clubMembers.id))
    .leftJoin(horses, eq(competitionEntries.horseId, horses.id))
    .where(
      and(
        eq(competitionResults.clubId, clubId),
        eq(competitionEntries.classId, classId),
      ),
    )
    .orderBy(asc(competitionResults.placing));
}

export async function createCompetitionResult(clubId: string, data: ResultCreate) {
  const values = {
    ...data,
    clubId,
    timeSeconds: data.timeSeconds != null ? String(data.timeSeconds) : null,
  } as NewResult;
  const result = await db.insert(competitionResults).values(values).returning();
  return result[0];
}

// ─── Calendar Integration ─────────────────────────────────────────────

export async function getCompetitionsForCalendar(clubId: string, dateFrom: string, dateTo: string) {
  return db
    .select({
      id: competitions.id,
      name: competitions.name,
      startDate: competitions.startDate,
      endDate: competitions.endDate,
      status: competitions.status,
      location: competitions.location,
    })
    .from(competitions)
    .where(
      and(
        eq(competitions.clubId, clubId),
        eq(competitions.isActive, true),
        sql`${competitions.startDate} <= ${dateTo}`,
        sql`${competitions.endDate} >= ${dateFrom}`,
      ),
    )
    .orderBy(asc(competitions.startDate));
}
