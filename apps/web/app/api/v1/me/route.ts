import { withAuth, successResponse } from '@/lib/api-utils';
import { getClubById, getActiveMembershipsForUser } from '@equestrian/db/queries';

export async function GET() {
  return withAuth(async (ctx) => {
    // Memberships are already loaded by `getTenantContext` on the
    // club_members fallback path (riders who joined via /discover) — reuse
    // them when present. The Clerk-active-org path doesn't load them, so
    // fall back to a direct fetch in that case.
    const [club, memberships] = await Promise.all([
      getClubById(ctx.clubId),
      ctx.memberships
        ? Promise.resolve(ctx.memberships)
        : getActiveMembershipsForUser(ctx.userId),
    ]);

    return successResponse({
      userId: ctx.userId,
      memberId: ctx.memberId,
      orgId: ctx.orgId,
      role: ctx.orgRole,
      activeClub: club
        ? { id: club.id, name: club.name, slug: club.slug }
        : null,
      memberships,
    });
  });
}
