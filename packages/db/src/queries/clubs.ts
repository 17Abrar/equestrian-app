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

/**
 * Audit pass-3 (2026-05-09): six routes were doing
 *   `select({ timezone }).from(clubs).where(eq(clubs.id, clubId))`
 * inline, without the `isNull(deletedAt)` gate. After Clerk's `org.deleted`
 * webhook lands, those reads would still resolve a tombstoned club's
 * timezone — defense-in-depth gap with `getClubById` and the dashboard
 * read paths. This helper bakes the gate in so callers can't forget it.
 *
 * Returns null when the club is missing or soft-deleted; the caller
 * must default (typical fallback is `Asia/Dubai`, matching the schema's
 * default).
 */
export async function getClubTimezone(clubId: string): Promise<string | null> {
  const result = await db
    .select({ timezone: clubs.timezone })
    .from(clubs)
    .where(and(eq(clubs.id, clubId), isNull(clubs.deletedAt)))
    .limit(1);

  return result[0]?.timezone ?? null;
}

export async function updateClubSettings(clubId: string, data: ClubUpdate) {
  const result = await db
    .update(clubs)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(clubs.id, clubId), isNull(clubs.deletedAt)))
    .returning();

  return result[0] ?? null;
}
