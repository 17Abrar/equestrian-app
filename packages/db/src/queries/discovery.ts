import { eq, and, desc, isNull, sql, ilike, inArray, type SQL } from 'drizzle-orm';
import { escapeLikePattern } from '@equestrian/shared/utils';
import { rawDb, db } from '../index';
import { clubs } from '../schema/clubs';
import { clubMembers } from '../schema/club-members';
import { clubJoinRequests } from '../schema/club-join-requests';

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

/**
 * Checks for an existing pending join request. Prevents spam.
 */
export async function hasPendingJoinRequest(
  clubId: string,
  clerkUserId: string,
): Promise<boolean> {
  const rows = await rawDb
    .select({ id: clubJoinRequests.id })
    .from(clubJoinRequests)
    .where(
      and(
        eq(clubJoinRequests.clubId, clubId),
        eq(clubJoinRequests.clerkUserId, clerkUserId),
        eq(clubJoinRequests.status, 'pending'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

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
 * `email` and `displayName` are written even on conflict so a fresh
 * Clerk profile (renamed user, updated email) re-syncs to the membership
 * row on rejoin.
 */
export async function joinClubInstantly(input: {
  clubId: string;
  clerkUserId: string;
  email: string | null;
  displayName: string | null;
}) {
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
      set: {
        isActive: true,
        email: input.email,
        displayName: input.displayName,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0];
}

/**
 * Approval-policy path: creates a pending join request. Club admins review
 * these from the admin queue.
 */
export async function createJoinRequest(input: {
  clubId: string;
  clerkUserId: string;
  email: string | null;
  displayName: string | null;
  message: string | null;
}) {
  const rows = await rawDb
    .insert(clubJoinRequests)
    .values({
      clubId: input.clubId,
      clerkUserId: input.clerkUserId,
      email: input.email,
      displayName: input.displayName,
      message: input.message,
      status: 'pending',
    })
    .returning();
  return rows[0];
}

// ─── Admin-side queue (tenant-scoped via `db`) ────────────────────────

export async function listJoinRequestsByClub(clubId: string, status: string = 'pending') {
  return db
    .select()
    .from(clubJoinRequests)
    .where(and(eq(clubJoinRequests.clubId, clubId), eq(clubJoinRequests.status, status)))
    .orderBy(desc(clubJoinRequests.createdAt));
}

export async function approveJoinRequest(
  clubId: string,
  requestId: string,
  reviewerMemberId: string | null,
) {
  // Flip to approved, then insert the member row. Using rawDb for the member
  // insert since club_members is exempt from RLS (tenant resolution lookups).
  const updated = await db
    .update(clubJoinRequests)
    .set({
      status: 'approved',
      reviewedByMemberId: reviewerMemberId ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clubJoinRequests.id, requestId),
        eq(clubJoinRequests.clubId, clubId),
        eq(clubJoinRequests.status, 'pending'),
      ),
    )
    .returning();

  if (!updated[0]) return null;

  const req = updated[0];
  const member = await rawDb
    .insert(clubMembers)
    .values({
      clubId,
      clerkUserId: req.clerkUserId,
      role: 'rider',
      email: req.email,
      displayName: req.displayName,
      isActive: true,
    })
    .returning();

  return { request: req, member: member[0] };
}

export async function declineJoinRequest(
  clubId: string,
  requestId: string,
  reviewerMemberId: string | null,
) {
  const rows = await db
    .update(clubJoinRequests)
    .set({
      status: 'declined',
      reviewedByMemberId: reviewerMemberId ?? null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clubJoinRequests.id, requestId),
        eq(clubJoinRequests.clubId, clubId),
        eq(clubJoinRequests.status, 'pending'),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

// Exported for tests / type inference. Not currently used inline but kept
// parallel to other query files.
export type PublicClub = Awaited<ReturnType<typeof listPublicClubs>>['data'][number];
export type PublicClubProfile = NonNullable<Awaited<ReturnType<typeof getPublicClubBySlug>>>;

// Silence unused-import for barrel re-exports that may go unused in Workers bundle.
export type _DiscoveryInArrayUnused = typeof inArray;
