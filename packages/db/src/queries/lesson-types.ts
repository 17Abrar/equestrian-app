import { eq, and, asc, sql } from 'drizzle-orm';
import { db } from '../index';
import { lessonTypes } from '../schema/bookings';

type NewLessonType = typeof lessonTypes.$inferInsert;
type LessonTypeCreate = Omit<NewLessonType, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>;
type LessonTypeUpdate = Partial<LessonTypeCreate>;

// Audit F-59 (2026-05-07 r4): explicit list-row projection. Same pattern
// as F-8 / F-58. Detail GET (`getLessonTypeById`) keeps the wide select.
export async function getLessonTypesByClub(
  clubId: string,
  { page, pageSize }: { page: number; pageSize: number },
) {
  const offset = (page - 1) * pageSize;
  const where = and(eq(lessonTypes.clubId, clubId), eq(lessonTypes.isActive, true));
  const [items, count] = await Promise.all([
    db
      .select({
        id: lessonTypes.id,
        clubId: lessonTypes.clubId,
        name: lessonTypes.name,
        type: lessonTypes.type,
        description: lessonTypes.description,
        durationMinutes: lessonTypes.durationMinutes,
        price: lessonTypes.price,
        currency: lessonTypes.currency,
        maxRiders: lessonTypes.maxRiders,
        minRiders: lessonTypes.minRiders,
        maxSessionsPerDay: lessonTypes.maxSessionsPerDay,
        arenaId: lessonTypes.arenaId,
        isActive: lessonTypes.isActive,
        color: lessonTypes.color,
        createdAt: lessonTypes.createdAt,
        updatedAt: lessonTypes.updatedAt,
      })
      .from(lessonTypes)
      .where(where)
      .orderBy(asc(lessonTypes.name))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(lessonTypes)
      .where(where),
  ]);
  return { items, total: count[0]?.count ?? 0 };
}

// Audit F-21 (2026-05-07 r4): row type derived from the projection.
export type LessonTypeListItem = Awaited<ReturnType<typeof getLessonTypesByClub>>['items'][number];

/**
 * Audit MED (2026-05-05 pass 2): forward-creation paths (booking-slots
 * create/bulk) must reject deactivated lesson types — soft-delete is
 * the only signal admins have to drop a type from rotation. Pass
 * `{ activeOnly: true }` from those routes; admin-detail reads (the
 * lesson-type's own GET endpoint) keep the default.
 */
export async function getLessonTypeById(
  clubId: string,
  lessonTypeId: string,
  options: { activeOnly?: boolean } = {},
) {
  const conditions = [eq(lessonTypes.id, lessonTypeId), eq(lessonTypes.clubId, clubId)];
  if (options.activeOnly) {
    conditions.push(eq(lessonTypes.isActive, true));
  }

  const result = await db
    .select()
    .from(lessonTypes)
    .where(and(...conditions))
    .limit(1);

  return result[0] ?? null;
}

export async function createLessonType(clubId: string, data: LessonTypeCreate) {
  const result = await db
    .insert(lessonTypes)
    .values({ ...data, clubId })
    .returning();
  return result[0];
}

export async function updateLessonType(
  clubId: string,
  lessonTypeId: string,
  data: LessonTypeUpdate,
) {
  const result = await db
    .update(lessonTypes)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(lessonTypes.id, lessonTypeId), eq(lessonTypes.clubId, clubId)))
    .returning();

  return result[0] ?? null;
}

export async function deleteLessonType(clubId: string, lessonTypeId: string) {
  const result = await db
    .update(lessonTypes)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(lessonTypes.id, lessonTypeId), eq(lessonTypes.clubId, clubId)))
    .returning({ id: lessonTypes.id });

  return result[0] ?? null;
}
