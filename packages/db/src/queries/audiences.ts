import { eq, and, gte, desc, sql, type SQL, inArray } from 'drizzle-orm';
import { db } from '../index';
import { audiences, type AudienceFilters } from '../schema/audiences';
import { clubMembers } from '../schema/club-members';
import { riderProfiles } from '../schema/rider-profiles';
import { bookings } from '../schema/bookings';

type NewAudience = typeof audiences.$inferInsert;
type AudienceCreate = Pick<NewAudience, 'name' | 'description' | 'filters'>;
type AudienceUpdate = Partial<AudienceCreate>;

export async function listAudiences(
  clubId: string,
  { page, pageSize }: { page: number; pageSize: number },
) {
  const offset = (page - 1) * pageSize;
  const where = eq(audiences.clubId, clubId);
  const [items, count] = await Promise.all([
    db
      .select()
      .from(audiences)
      .where(where)
      .orderBy(desc(audiences.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(audiences)
      .where(where),
  ]);
  return { items, total: count[0]?.count ?? 0 };
}

export async function getAudienceById(clubId: string, audienceId: string) {
  const rows = await db
    .select()
    .from(audiences)
    .where(and(eq(audiences.id, audienceId), eq(audiences.clubId, clubId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createAudience(
  clubId: string,
  data: AudienceCreate,
  createdByMemberId: string | null,
) {
  const rows = await db
    .insert(audiences)
    .values({
      clubId,
      name: data.name,
      description: data.description ?? null,
      filters: data.filters ?? {},
      createdByMemberId: createdByMemberId ?? null,
    })
    .returning();
  return rows[0];
}

export async function updateAudience(
  clubId: string,
  audienceId: string,
  data: AudienceUpdate,
) {
  const rows = await db
    .update(audiences)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(audiences.id, audienceId), eq(audiences.clubId, clubId)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteAudience(clubId: string, audienceId: string) {
  const rows = await db
    .delete(audiences)
    .where(and(eq(audiences.id, audienceId), eq(audiences.clubId, clubId)))
    .returning({ id: audiences.id });
  return rows[0] ?? null;
}

/**
 * Translates an AudienceFilters object into a set of SQL predicates evaluated
 * against `club_members`. Returns the matching rows (id, email, displayName).
 * Unknown filter fields are ignored — the jsonb column is intentionally loose.
 *
 * The filters are AND-combined. `activeWithinDays` cross-joins with bookings
 * to check recency; `minBookings` counts lifetime bookings per rider.
 */
export async function resolveAudienceMembers(
  clubId: string,
  filters: AudienceFilters,
) {
  const conditions: SQL[] = [
    eq(clubMembers.clubId, clubId),
    eq(clubMembers.role, 'rider'),
    eq(clubMembers.isActive, true),
  ];

  if (filters.skillLevel) {
    // Join to rider_profiles via memberId
    const matchingMemberIds = db
      .select({ memberId: riderProfiles.memberId })
      .from(riderProfiles)
      .where(
        and(
          eq(riderProfiles.clubId, clubId),
          eq(riderProfiles.skillLevel, filters.skillLevel),
        ),
      );
    conditions.push(inArray(clubMembers.id, matchingMemberIds));
  }

  if (typeof filters.minBookings === 'number' && filters.minBookings > 0) {
    const bookingCounts = db
      .select({
        memberId: bookings.riderMemberId,
        count: sql<number>`count(*)::int`.as('booking_count'),
      })
      .from(bookings)
      .where(eq(bookings.clubId, clubId))
      .groupBy(bookings.riderMemberId)
      .having(sql`count(*)::int >= ${filters.minBookings}`)
      .as('booking_counts');
    const qualifyingIds = db
      .select({ memberId: bookingCounts.memberId })
      .from(bookingCounts);
    conditions.push(inArray(clubMembers.id, qualifyingIds));
  }

  if (typeof filters.activeWithinDays === 'number' && filters.activeWithinDays > 0) {
    const since = new Date();
    since.setDate(since.getDate() - filters.activeWithinDays);
    const recentIds = db
      .selectDistinct({ memberId: bookings.riderMemberId })
      .from(bookings)
      .where(and(eq(bookings.clubId, clubId), gte(bookings.createdAt, since)));
    conditions.push(inArray(clubMembers.id, recentIds));
  }

  return db
    .select({
      id: clubMembers.id,
      email: clubMembers.email,
      displayName: clubMembers.displayName,
    })
    .from(clubMembers)
    .where(and(...conditions));
}

/**
 * Convenience wrapper that just returns the count. Used for UI previews.
 */
export async function countAudienceMembers(
  clubId: string,
  filters: AudienceFilters,
): Promise<number> {
  const members = await resolveAudienceMembers(clubId, filters);
  return members.length;
}

/**
 * Batched counts for many filter sets in one round-trip. The list-audiences
 * UI was previously firing one `countAudienceMembers` per audience —
 * Promise.all-wrapped, but still N round-trips. Here we pull every eligible
 * rider plus the attributes the filters reference once, then evaluate each
 * filter in memory. Equivalence with `resolveAudienceMembers` is mechanical:
 * skillLevel comes from the same LEFT JOIN, minBookings from the booking
 * count aggregate, activeWithinDays from the latest booking timestamp.
 */
export async function countAudienceMembersBatch(
  clubId: string,
  filterSets: AudienceFilters[],
): Promise<number[]> {
  if (filterSets.length === 0) return [];

  const bookingAgg = db
    .select({
      memberId: bookings.riderMemberId,
      totalBookings: sql<number>`count(*)::int`.as('total_bookings'),
      lastBookingAt: sql<Date | null>`max(${bookings.createdAt})`.as('last_booking_at'),
    })
    .from(bookings)
    .where(eq(bookings.clubId, clubId))
    .groupBy(bookings.riderMemberId)
    .as('booking_agg');

  const rows = await db
    .select({
      memberId: clubMembers.id,
      skillLevel: riderProfiles.skillLevel,
      totalBookings: sql<number>`coalesce(${bookingAgg.totalBookings}, 0)`,
      lastBookingAt: bookingAgg.lastBookingAt,
    })
    .from(clubMembers)
    .leftJoin(
      riderProfiles,
      and(
        eq(riderProfiles.memberId, clubMembers.id),
        eq(riderProfiles.clubId, clubId),
      ),
    )
    .leftJoin(bookingAgg, eq(bookingAgg.memberId, clubMembers.id))
    .where(
      and(
        eq(clubMembers.clubId, clubId),
        eq(clubMembers.role, 'rider'),
        eq(clubMembers.isActive, true),
      ),
    );

  const now = Date.now();
  const DAY_MS = 86_400_000;

  return filterSets.map((filters) => {
    let count = 0;
    for (const r of rows) {
      if (filters.skillLevel && r.skillLevel !== filters.skillLevel) continue;
      if (
        typeof filters.minBookings === 'number' &&
        filters.minBookings > 0 &&
        r.totalBookings < filters.minBookings
      ) continue;
      if (
        typeof filters.activeWithinDays === 'number' &&
        filters.activeWithinDays > 0
      ) {
        if (!r.lastBookingAt) continue;
        const daysSince = (now - new Date(r.lastBookingAt).getTime()) / DAY_MS;
        if (daysSince > filters.activeWithinDays) continue;
      }
      count += 1;
    }
    return count;
  });
}
