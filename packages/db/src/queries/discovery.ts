import { eq, and, desc, isNull, sql, ilike, type inArray, type SQL } from 'drizzle-orm';
import { escapeLikePattern } from '@equestrian/shared/utils';
import { rawDb } from '../index';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';
import { type clubJoinRequests } from '../schema/club-join-requests';

// ─── Public discovery (rawDb — no tenant context needed) ──────────────
//
// These queries intentionally use rawDb because they run outside any tenant
// context. The /discover page is public; anyone (authenticated or not) should
// see the same list of clubs that opted into public listing.

interface DiscoveryFilters {
  search?: string;
  city?: string;
  page: number;
  pageSize: number;
}

/**
 * Lists clubs that have opted into public discovery. Soft-deleted clubs are
 * always hidden. Returned fields are the "marketing card" subset — enough to
 * render a grid without exposing sensitive config.
 */
export async function listPublicClubs(filters: DiscoveryFilters) {
  const conditions: SQL[] = [
    eq(clubs.isPublicListing, true),
    isNull(clubs.deletedAt),
    eq(clubs.isActive, true),
  ];

  if (filters.search) {
    conditions.push(ilike(clubs.name, `%${escapeLikePattern(filters.search)}%`));
  }
  if (filters.city) {
    conditions.push(ilike(clubs.city, `%${escapeLikePattern(filters.city)}%`));
  }

  const where = and(...conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  const [rows, totalRow] = await Promise.all([
    rawDb
      .select({
        id: clubs.id,
        name: clubs.name,
        slug: clubs.slug,
        city: clubs.city,
        country: clubs.country,
        logoUrl: clubs.logoUrl,
        coverPhotoUrl: clubs.coverPhotoUrl,
        shortDescription: clubs.shortDescription,
        description: clubs.description,
        joinPolicy: clubs.joinPolicy,
        brandPrimaryColor: clubs.brandPrimaryColor,
      })
      .from(clubs)
      .where(where)
      .orderBy(desc(clubs.createdAt))
      .limit(filters.pageSize)
      .offset(offset),
    rawDb
      .select({ count: sql<number>`count(*)::int` })
      .from(clubs)
      .where(where),
  ]);

  return { data: rows, total: totalRow[0]?.count ?? 0 };
}

/**
 * Public club profile page — same subset as the listing, plus website and
 * socials so the visitor can explore before joining.
 */
export async function getPublicClubBySlug(slug: string) {
  const rows = await rawDb
    .select({
      id: clubs.id,
      name: clubs.name,
      slug: clubs.slug,
      city: clubs.city,
      country: clubs.country,
      timezone: clubs.timezone,
      logoUrl: clubs.logoUrl,
      coverPhotoUrl: clubs.coverPhotoUrl,
      shortDescription: clubs.shortDescription,
      description: clubs.description,
      websiteUrl: clubs.websiteUrl,
      socialInstagram: clubs.socialInstagram,
      socialFacebook: clubs.socialFacebook,
      socialTiktok: clubs.socialTiktok,
      joinPolicy: clubs.joinPolicy,
      brandPrimaryColor: clubs.brandPrimaryColor,
      brandSecondaryColor: clubs.brandSecondaryColor,
    })
    .from(clubs)
    .where(
      and(
        eq(clubs.slug, slug),
        eq(clubs.isPublicListing, true),
        isNull(clubs.deletedAt),
        eq(clubs.isActive, true),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

// ─── Joining (rawDb because we resolve the club before tenant context) ────

/**
 * Checks whether a given Clerk user is already a member of the club. Used to
 * prevent duplicate memberships and to short-circuit the join flow.
 */
export async function isUserMember(clubId: string, clerkUserId: string): Promise<boolean> {
  const rows = await rawDb
    .select({ id: clubMembers.id })
    .from(clubMembers)
    .where(
      and(
        eq(clubMembers.clubId, clubId),
        eq(clubMembers.clerkUserId, clerkUserId),
        eq(clubMembers.isActive, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// `club_join_requests` (the schema + queries below) are scaffolding for an
// admin-approval join policy that was deliberately removed in favour of
// instant-join / invite-only. Audit F-13 + the join-route comment at
// /api/v1/clubs/[slug]/join/route.ts:67–69. Kept here only so the schema
// import compiles; nothing in apps/* references these helpers. If you add
// the approval queue back, restore the helpers below from git history.

/**
 * Result of a `joinClubInstantly` attempt:
 *  - `joined`: caller is now an active member (fresh insert OR voluntary-
 *    leaver reactivated). Route returns 200.
 *  - `kicked`: an admin previously deactivated this user via the staff
 *    moderation UI; the row stays inactive and the route returns 403.
 */
export type JoinResult =
  | { status: 'joined'; member: typeof clubMembers.$inferSelect }
  | { status: 'kicked'; memberId: string | null };

/**
 * Open-policy path: rider is instantly added as a club_member with role=rider.
 * Must be called only when the club's joinPolicy is 'open'.
 *
 * Idempotent on (club_id, clerk_user_id): a duplicate INSERT (double-click,
 * concurrent retries) maps via ON CONFLICT DO UPDATE so the second caller
 * gets the existing row back instead of a 23505 → 500. A previously-left
 * member (`is_active=false`) is reactivated in the same path — the audit
 * race E-4 manifested as a permanent 500 for users who tried to rejoin
 * after leaving, because `isUserMember` filtered on `isActive=true` while
 * the unique index spans both states.
 *
 * Audit J-1: an admin-kicked member (deactivatedByAdminAt IS NOT NULL)
 * canNOT rejoin via this path. The function returns `{status: 'kicked'}`
 * and leaves the row untouched so the existing inactive state persists
 * — the route caller surfaces a 403 to the rider. Voluntary-leave is
 * still allowed (no admin stamp on the row).
 *
 * `email` and `displayName` are written even on conflict so a fresh
 * Clerk profile (renamed user, updated email) re-syncs to the membership
 * row on rejoin.
 */
export async function joinClubInstantly(input: {
  clubId: string;
  clerkUserId: string;
  email: string | null;
  displayName: string | null;
}): Promise<JoinResult> {
  // Pre-check: refuse rejoin if a previous admin DELETE stamped
  // `deactivatedByAdminAt`. Cheap point lookup hitting the partial index
  // (only kicked rows are stored). The narrow race between this check and
  // the upsert is closed by the conditional ON CONFLICT below — the
  // upsert itself only flips is_active when the column is null.
  const existing = await rawDb
    .select({
      id: clubMembers.id,
      isActive: clubMembers.isActive,
      deactivatedByAdminAt: clubMembers.deactivatedByAdminAt,
    })
    .from(clubMembers)
    .where(
      and(eq(clubMembers.clubId, input.clubId), eq(clubMembers.clerkUserId, input.clerkUserId)),
    )
    .limit(1);

  if (existing[0]?.deactivatedByAdminAt) {
    // Audit r5 F-8 (2026-05-07): surface the existing memberId so the
    // join route can record `club_member.join_refused_deactivated` against
    // the right resource id.
    return { status: 'kicked', memberId: existing[0].id };
  }

  const rows = await rawDb
    .insert(clubMembers)
    .values({
      clubId: input.clubId,
      clerkUserId: input.clerkUserId,
      role: 'rider',
      email: input.email,
      displayName: input.displayName,
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [clubMembers.clubId, clubMembers.clerkUserId],
      // Only flip `is_active` to true when the row was NOT
      // admin-deactivated. The pre-check above already returned for that
      // case, but a TOCTOU between the SELECT and INSERT could let a
      // concurrent admin DELETE land in between. The CASE expression
      // closes that window by re-evaluating the column at upsert time.
      set: {
        isActive: sql`CASE WHEN ${clubMembers.deactivatedByAdminAt} IS NULL THEN true ELSE ${clubMembers.isActive} END`,
        email: input.email,
        displayName: input.displayName,
        updatedAt: new Date(),
      },
    })
    .returning();

  const member = rows[0];
  if (!member || !member.isActive) {
    return { status: 'kicked', memberId: member?.id ?? null };
  }
  return { status: 'joined', member };
}

// Exported for tests / type inference. Not currently used inline but kept
// parallel to other query files.
export type PublicClub = Awaited<ReturnType<typeof listPublicClubs>>['data'][number];
export type PublicClubProfile = NonNullable<Awaited<ReturnType<typeof getPublicClubBySlug>>>;

// Silence unused-import for barrel re-exports that may go unused in Workers bundle.
export type _DiscoveryInArrayUnused = typeof inArray;
// `clubJoinRequests` is held by the schema for the dropped approval-queue
// flow (audit F-13); referencing the symbol here keeps the import live so
// the schema package's `export *` still emits the table type for any
// future re-introduction of the feature.
export type _DiscoveryJoinRequestsUnused = typeof clubJoinRequests;
