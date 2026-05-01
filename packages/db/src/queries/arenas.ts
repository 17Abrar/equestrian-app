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

export async function getArenaById(clubId: string, arenaId: string) {
  const result = await db
    .select()
    .from(arenas)
    .where(and(eq(arenas.id, arenaId), eq(arenas.clubId, clubId)))
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
