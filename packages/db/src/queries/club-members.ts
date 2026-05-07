import { eq, and, asc, ilike, inArray, sql, SQL } from 'drizzle-orm';
import { db } from '../index';
import { clubMembers } from '../schema/club-members';
import { escapeLikePattern } from '@equestrian/shared/utils';

// `inArray` is typed against the column's enum literal union, but the
// values reaching `getMembersByRole` originate from query-string params
// (`string[]`) we can't narrow at the TS layer. Postgres rejects any
// value outside the enum at query time, so a runtime guard adds nothing
// the DB doesn't already provide. Casts to this alias unblock the type
// system without weakening validation.
type ClubMemberRole = (typeof clubMembers.role.enumValues)[number];

type NewMember = typeof clubMembers.$inferInsert;
type MemberCreate = Omit<NewMember, 'id' | 'clubId' | 'createdAt' | 'updatedAt' | 'joinedAt'>;
type MemberUpdate = Partial<Omit<MemberCreate, 'clerkUserId'>>;

/**
 * Get club members filtered by role(s). Used for dropdowns (rider selection,
 * owner selection, coach assignment, etc.)
 *
 * An empty `roles` array means "no role filter" and returns every active
 * member of the club. Postgres treats `= ANY(array[])` as `false`, so a
 * literal pass-through would silently return zero rows — the dropdowns
 * that omit the `role` query param were rendering empty for that reason.
 */
export async function getMembersByRole(
  clubId: string,
  roles: string[],
  { page, pageSize }: { page: number; pageSize: number },
) {
  const conditions: SQL[] = [
    eq(clubMembers.clubId, clubId),
    eq(clubMembers.isActive, true),
  ];

  if (roles.length > 0) {
    // P0 2026-05-06: switched from `sql\`= ANY(${roles})\`` to `inArray`.
    // The raw template was generating `ANY(($3, $4, $5))` — Postgres
    // parses that as a row constructor, not an array, and the implicit
    // scalar-to-enum cast against the `role` user_role column failed
    // with "malformed array literal" / "input syntax for type
    // user_role". `inArray` generates `IN (...)` which casts cleanly.
    conditions.push(inArray(clubMembers.role, roles as ClubMemberRole[]));
  }

  const where = and(...conditions);
  const offset = (page - 1) * pageSize;

  const [items, count] = await Promise.all([
    db
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
      .where(where)
      .orderBy(asc(clubMembers.displayName))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(clubMembers)
      .where(where),
  ]);

  return { items, total: count[0]?.count ?? 0 };
}

interface StaffFilters {
  search?: string;
  role?: string;
  page: number;
  pageSize: number;
}

export async function getStaffByClub(clubId: string, filters: StaffFilters) {
  // P0 2026-05-06: same `sql\`= ANY(...)\`` → `inArray` swap as
  // `getMembersByRole` above. See that comment for full context.
  const staffRoles: ClubMemberRole[] = ['club_manager', 'coach', 'groom'];
  const conditions: SQL[] = [
    eq(clubMembers.clubId, clubId),
    eq(clubMembers.isActive, true),
    inArray(clubMembers.role, staffRoles),
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

/**
 * Lookup a member by id, scoped to the club AND active-only. The
 * active-only filter is the security-relevant default — see audit F-30
 * (2026-05-07 r4): a deactivated member should not be a valid target
 * for booking POST, horse-owner reassignment, coach assignment, coupon
 * validation, or any other "is X a member of this club right now?"
 * gate. Sister helper `getMemberByIdIncludingDeactivated` exists for
 * the legitimate historical-view cases (staff detail page,
 * owners detail page, post-response transactional emails for prior
 * bookings, cron coach-name resolution).
 *
 * If you find yourself reaching for IncludingDeactivated on a write
 * path that takes a member id from request input, you almost certainly
 * want this strict variant instead.
 */
export async function getMemberById(clubId: string, memberId: string) {
  const result = await db
    .select()
    .from(clubMembers)
    .where(
      and(
        eq(clubMembers.id, memberId),
        eq(clubMembers.clubId, clubId),
        eq(clubMembers.isActive, true),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}

/**
 * Audit F-30 (2026-05-07 r4): historical-view sibling. Returns members
 * regardless of `is_active`. Use ONLY for routes that legitimately need
 * to see deactivated rows:
 *
 * - `/api/v1/staff/[memberId]` (GET to show history, PATCH to
 *   reactivate, DELETE on already-deactivated rows)
 * - `/api/v1/owners/[memberId]` (sister to staff)
 * - Post-response emails (`after()`) for bookings whose rider was
 *   deactivated between booking creation and email dispatch
 * - Cron coach-name resolution for reminders on prior-issued bookings
 *
 * Never use on write paths that accept a member id from request input
 * (booking POST, horse-owner transfer, coach assignment, etc.) — those
 * must use the strict `getMemberById`.
 */
export async function getMemberByIdIncludingDeactivated(
  clubId: string,
  memberId: string,
) {
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

/**
 * Admin-driven deactivation. Audit J-1 — stamps `deactivatedByAdminAt`
 * so `joinClubInstantly` can refuse a rejoin attempt by the kicked
 * member. Voluntary-leave flows (none today; future "leave club"
 * button) should write `is_active = false` WITHOUT setting this column,
 * preserving the rider's ability to come back.
 */
export async function deactivateMember(clubId: string, memberId: string) {
  const result = await db
    .update(clubMembers)
    .set({
      isActive: false,
      deactivatedByAdminAt: new Date(),
      updatedAt: new Date(),
    })
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
