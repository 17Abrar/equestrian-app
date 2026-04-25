import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../index';
import { clubs } from '../schema/clubs';

type ClubUpdate = Partial<Omit<typeof clubs.$inferInsert, 'id' | 'createdAt' | 'updatedAt' | 'clerkOrgId'>>;

// `deleted_at` is set by the Clerk `organization.deleted` webhook. Filtering
// it out here means downstream callers (cron emails, fee calculations, brand
// snapshots) can't read back a tombstoned club's name/logo/timezone.
export async function getClubById(clubId: string) {
  const result = await db
    .select()
    .from(clubs)
    .where(and(eq(clubs.id, clubId), isNull(clubs.deletedAt)))
    .limit(1);

  return result[0] ?? null;
}

export async function updateClubSettings(clubId: string, data: ClubUpdate) {
  const result = await db
    .update(clubs)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(clubs.id, clubId), isNull(clubs.deletedAt)))
    .returning();

  return result[0] ?? null;
}
