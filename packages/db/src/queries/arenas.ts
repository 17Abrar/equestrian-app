import { eq, and, asc, sql } from 'drizzle-orm';
import { db } from '../index';
import { arenas } from '../schema/bookings';

type NewArena = typeof arenas.$inferInsert;
type ArenaCreate = Omit<NewArena, 'id' | 'clubId' | 'createdAt' | 'updatedAt'>;
type ArenaUpdate = Partial<ArenaCreate>;

export async function getArenasByClub(
  clubId: string,
  { page, pageSize }: { page: number; pageSize: number },
) {
  const offset = (page - 1) * pageSize;
  const where = and(eq(arenas.clubId, clubId), eq(arenas.isActive, true));
  const [items, count] = await Promise.all([
    db
      .select()
      .from(arenas)
      .where(where)
      .orderBy(asc(arenas.name))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(arenas)
      .where(where),
  ]);
  return { items, total: count[0]?.count ?? 0 };
}

/**
 * Audit MED (2026-05-05 pass 2): forward-creation paths (booking-slots
 * create/update/bulk) must reject deactivated arenas — soft-delete is
 * the only signal admins have to drop an arena from rotation. Pass
 * `{ activeOnly: true }` from those routes; admin-detail reads (the
 * arena's own GET endpoint) keep the default to surface deactivated
 * rows for re-activation flows.
 */
export async function getArenaById(
  clubId: string,
  arenaId: string,
  options: { activeOnly?: boolean } = {},
) {
  const conditions = [eq(arenas.id, arenaId), eq(arenas.clubId, clubId)];
  if (options.activeOnly) {
    conditions.push(eq(arenas.isActive, true));
  }

  const result = await db
    .select()
    .from(arenas)
    .where(and(...conditions))
    .limit(1);

  return result[0] ?? null;
}

export async function createArena(clubId: string, data: ArenaCreate) {
  const result = await db.insert(arenas).values({ ...data, clubId }).returning();
  return result[0];
}

export async function updateArena(clubId: string, arenaId: string, data: ArenaUpdate) {
  const result = await db
    .update(arenas)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(arenas.id, arenaId), eq(arenas.clubId, clubId)))
    .returning();

  return result[0] ?? null;
}

export async function deleteArena(clubId: string, arenaId: string) {
  const result = await db
    .update(arenas)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(arenas.id, arenaId), eq(arenas.clubId, clubId)))
    .returning({ id: arenas.id });

  return result[0] ?? null;
}
