import { withAuth, successResponse } from '@/lib/api-utils';
import { getClubById, getActiveMembershipsForUser } from '@equestrian/db/queries';

export async function GET() {
  return withAuth(async (ctx) => {
    // Include the active club's display name + the user's full membership
    // list so the rider nav can show "booking from X" and render a switcher
    // without a second round-trip.
    const [club, memberships] = await Promise.all([
      getClubById(ctx.clubId),
      getActiveMembershipsForUser(ctx.userId),
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
