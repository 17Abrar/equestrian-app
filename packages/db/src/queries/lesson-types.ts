import { eq, and, asc } from 'drizzle-orm';
import { db } from '../index';
import { lessonTypes } from '../schema/bookings';

type NewLessonType = typeof lessonTypes.$inferInsert;
type LessonTypeCreate = Omit<NewLessonType, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>;
type LessonTypeUpdate = Partial<LessonTypeCreate>;

export async function getLessonTypesByClub(clubId: string) {
  return db
    .select()
    .from(lessonTypes)
    .where(and(eq(lessonTypes.clubId, clubId), eq(lessonTypes.isActive, true)))
    .orderBy(asc(lessonTypes.name));
}

export async function getLessonTypeById(clubId: string, lessonTypeId: string) {
  const result = await db
    .select()
    .from(lessonTypes)
    .where(and(eq(lessonTypes.id, lessonTypeId), eq(lessonTypes.clubId, clubId)))
    .limit(1);

  return result[0] ?? null;
}

export async function createLessonType(clubId: string, data: LessonTypeCreate) {
  const result = await db.insert(lessonTypes).values({ ...data, clubId }).returning();
  return result[0];
}

export async function updateLessonType(clubId: string, lessonTypeId: string, data: LessonTypeUpdate) {
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
