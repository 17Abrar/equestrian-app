import { eq } from 'drizzle-orm';
import { db } from '../index';
import { clubs } from '../schema/clubs';

type ClubUpdate = Partial<Omit<typeof clubs.$inferInsert, 'id' | 'createdAt' | 'updatedAt' | 'clerkOrgId'>>;

export async function getClubById(clubId: string) {
  const result = await db
    .select()
    .from(clubs)
    .where(eq(clubs.id, clubId))
    .limit(1);

  return result[0] ?? null;
}

export async function updateClubSettings(clubId: string, data: ClubUpdate) {
  const result = await db
    .update(clubs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(clubs.id, clubId))
    .returning();

  return result[0] ?? null;
}
