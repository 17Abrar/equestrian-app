import { eq, and, asc, ilike, sql, SQL } from 'drizzle-orm';
import { db } from '../index';
import { clubMembers } from '../schema/club-members';
import { escapeLikePattern } from '@equestrian/shared/utils';

type NewMember = typeof clubMembers.$inferInsert;
type MemberCreate = Omit<NewMember, 'id' | 'clubId' | 'createdAt' | 'updatedAt' | 'joinedAt'>;
type MemberUpdate = Partial<Omit<MemberCreate, 'clerkUserId'>>;

/**
 * Get club members filtered by role(s). Used for dropdowns (rider selection,
 * owner selection, coach assignment, etc.)
 */
export async function getMembersByRole(clubId: string, roles: string[]) {
  return db
    .select({
      id: clubMembers.id,
      clerkUserId: clubMembers.clerkUserId,
      role: clubMembers.role,
      displayName: clubMembers.displayName,
      email: clubMembers.email,
      phone: clubMembers.phone,
      isActive: clubMembers.isActive,
    })
    .from(clubMembers)
    .where(
      and(
        eq(clubMembers.clubId, clubId),
        eq(clubMembers.isActive, true),
        sql`${clubMembers.role} = ANY(${roles})`,
      ),
    )
    .orderBy(asc(clubMembers.displayName));
}

interface StaffFilters {
  search?: string;
  role?: string;
  page: number;
  pageSize: number;
}

export async function getStaffByClub(clubId: string, filters: StaffFilters) {
  const staffRoles = ['club_manager', 'coach', 'groom'];
  const conditions: SQL[] = [
    eq(clubMembers.clubId, clubId),
    eq(clubMembers.isActive, true),
    sql`${clubMembers.role} = ANY(${staffRoles})`,
  ];

  if (filters.role) {
    conditions.push(sql`${clubMembers.role} = ${filters.role}`);
  }

  if (filters.search) {
    conditions.push(ilike(clubMembers.displayName, `%${escapeLikePattern(filters.search)}%`));
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(clubMembers)
      .where(where)
      .orderBy(asc(clubMembers.displayName))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(clubMembers)
      .where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}

export async function getOwnersByClub(clubId: string, filters: { search?: string; page: number; pageSize: number }) {
  const conditions: SQL[] = [
    eq(clubMembers.clubId, clubId),
    eq(clubMembers.isActive, true),
    sql`${clubMembers.role} = 'horse_owner'`,
  ];

  if (filters.search) {
    conditions.push(ilike(clubMembers.displayName, `%${escapeLikePattern(filters.search)}%`));
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(clubMembers)
      .where(where)
      .orderBy(asc(clubMembers.displayName))
      .limit(filters.pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(clubMembers)
      .where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}

export async function getMemberById(clubId: string, memberId: string) {
  const result = await db
    .select()
    .from(clubMembers)
    .where(and(eq(clubMembers.id, memberId), eq(clubMembers.clubId, clubId)))
    .limit(1);

  return result[0] ?? null;
}

export async function createMember(clubId: string, data: MemberCreate) {
  const result = await db
    .insert(clubMembers)
    .values({ ...data, clubId })
    .returning();
  return result[0];
}

export async function updateMember(clubId: string, memberId: string, data: MemberUpdate) {
  const result = await db
    .update(clubMembers)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(clubMembers.id, memberId), eq(clubMembers.clubId, clubId)))
    .returning();
  return result[0] ?? null;
}

export async function deactivateMember(clubId: string, memberId: string) {
  const result = await db
    .update(clubMembers)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(clubMembers.id, memberId), eq(clubMembers.clubId, clubId)))
    .returning({ id: clubMembers.id });
  return result[0] ?? null;
}

/**
 * Count of active `club_admin` members in a club. Used by the staff routes
 * to refuse the deactivation or demotion that would drop the count to zero
 * — locking everyone out of admin operations with no in-app recovery path.
 */
export async function countActiveAdmins(clubId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clubMembers)
    .where(
      and(
        eq(clubMembers.clubId, clubId),
        eq(clubMembers.isActive, true),
        sql`${clubMembers.role} = 'club_admin'`,
      ),
    );
  return result[0]?.count ?? 0;
}
