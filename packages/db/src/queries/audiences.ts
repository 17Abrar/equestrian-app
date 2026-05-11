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
  // Audit F-32: explicit projection mirroring the AudienceRow component.
  // `createdByMemberId` is not surfaced in the list view; drop it from
  // the wire to keep the per-row payload minimal.
  const [items, count] = await Promise.all([
    db
      .select({
        id: audiences.id,
        clubId: audiences.clubId,
        name: audiences.name,
        description: audiences.description,
        filters: audiences.filters,
        createdAt: audiences.createdAt,
        updatedAt: audiences.updatedAt,
      })
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

/** List-row shape for `listAudiences` (audit F-32). */
export type AudienceListItem = Awaited<ReturnType<typeof listAudiences>>['items'][number];

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

export async function updateAudience(clubId: string, audienceId: string, data: AudienceUpdate) {
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
 * Audit r5 F-1 (2026-05-07): cap on the projection size returned to detail
 * GET callers. Used as a defence against unbounded scans / unbounded JSON
 * payloads. The total count is surfaced separately via `countAudienceMembers`
 * so the UI can render `(showing X of N)`.
 */
export const MEMBERS_PREVIEW_CAP = 500;

/**
 * Translates an AudienceFilters object into a set of SQL predicates evaluated
 * against `club_members`. Returns the matching rows (id, email, displayName).
 * Unknown filter fields are ignored — the jsonb column is intentionally loose.
 *
 * The filters are AND-combined. `activeWithinDays` cross-joins with bookings
 * to check recency; `minBookings` counts lifetime bookings per rider.
 *
 * Audit r5 F-1: results are capped at `MEMBERS_PREVIEW_CAP` to prevent
 * unbounded payloads on full-membership audiences. Pass `limit` to override.
 */
export async function resolveAudienceMembers(
  clubId: string,
  filters: AudienceFilters,
  options?: { limit?: number },
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
        and(eq(riderProfiles.clubId, clubId), eq(riderProfiles.skillLevel, filters.skillLevel)),
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
    const qualifyingIds = db.select({ memberId: bookingCounts.memberId }).from(bookingCounts);
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

  const limit = options?.limit ?? MEMBERS_PREVIEW_CAP;
  return db
    .select({
      id: clubMembers.id,
      email: clubMembers.email,
      displayName: clubMembers.displayName,
    })
    .from(clubMembers)
    .where(and(...conditions))
    .limit(limit);
}

/**
 * Build the SQL predicate list for an audience filter set. Used by both
 * `countAudienceMembers` and `countAudienceMembersBatch` so the two paths
 * stay byte-equivalent — see the M-1 regression test in
 * `audiences.test.ts` for the equivalence contract.
 *
 * Predicates AND together over `clubMembers`:
 *   - skillLevel       → `inArray(memberId, rider_profiles WHERE …)`
 *   - minBookings      → `inArray(memberId, bookings GROUP BY HAVING count >= N)`
 *   - activeWithinDays → `inArray(memberId, distinct bookings WHERE created_at >= since)`
 */
function buildAudiencePredicates(clubId: string, filters: AudienceFilters): SQL[] {
  const conditions: SQL[] = [
    eq(clubMembers.clubId, clubId),
    eq(clubMembers.role, 'rider'),
    eq(clubMembers.isActive, true),
  ];

  if (filters.skillLevel) {
    const matchingMemberIds = db
      .select({ memberId: riderProfiles.memberId })
      .from(riderProfiles)
      .where(
        and(eq(riderProfiles.clubId, clubId), eq(riderProfiles.skillLevel, filters.skillLevel)),
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
    const qualifyingIds = db.select({ memberId: bookingCounts.memberId }).from(bookingCounts);
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

  return conditions;
}

/**
 * Convenience wrapper that just returns the count. Used for UI previews.
 *
 * Audit r5 F-1 (2026-05-07): replaced naive `resolve.length` (which now caps
 * at MEMBERS_PREVIEW_CAP) with a SQL-side `count(*)`, matching the predicates
 * in `resolveAudienceMembers`. Mirrors the structure used by
 * `countAudienceMembersBatch` so equivalence holds for the same filter set.
 */
export async function countAudienceMembers(
  clubId: string,
  filters: AudienceFilters,
): Promise<number> {
  const conditions = buildAudiencePredicates(clubId, filters);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(clubMembers)
    .where(and(...conditions));
  return rows[0]?.count ?? 0;
}

/**
 * Batched counts for many filter sets. Pre-fix this loaded every active
 * rider in the tenant into memory and evaluated each filter set against the
 * in-memory rowset — fine at JSR's seed scale, but unbounded against
 * `clubMembers + riderProfiles + bookings` aggregate. A 5,000-rider club
 * loaded 5,000 rows on every audiences-list GET (audit r6 F-5, HIGH).
 *
 * Now: emit one `count(*)` per filter set against the same predicate logic
 * as `countAudienceMembers`, fanned out via `Promise.all`. The audiences
 * list view paginates at 25, so this is ≤25 sub-second `count(*)` queries —
 * Postgres's count plan over the indexed `(club_id, role, is_active)` tuple
 * resolves in tens of milliseconds per query. The planner short-circuits
 * the empty-filter case to a plain count on `clubMembers` with no JOINs.
 *
 * Equivalence with the per-call `countAudienceMembers` is now mechanical
 * (same predicate builder); the M-1 regression test in `audiences.test.ts`
 * still locks down per-filter-set equivalence with `resolveAudienceMembers`.
 */
export async function countAudienceMembersBatch(
  clubId: string,
  filterSets: AudienceFilters[],
): Promise<number[]> {
  if (filterSets.length === 0) return [];
  return Promise.all(filterSets.map((filters) => countAudienceMembers(clubId, filters)));
}
