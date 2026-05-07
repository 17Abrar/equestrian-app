import { type NextRequest } from 'next/server';
import { type UserRole } from '@equestrian/shared/types';
import { getMembersByRole } from '@equestrian/db/queries';
import {
  withAuth,
  errorResponse,
  parsePagination,
  paginatedListResponse,
} from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

// Audit HIGH-2 (2026-05-05 pass 2): the previous shape used a *blocklist*
// (`STAFF_ROLES`) — a coach with `riders:read` was rejected when probing
// `?role=club_admin` but slipped through with `?role=horse_owner` or
// `?role=parent`, harvesting the club's owner/parent roster including
// email + phone. Worse, an empty `role=` returned EVERY member. Switch
// to an *allowlist*: callers without `staff:read` are scoped to riders
// only — no role= and any non-`rider` value 403s. `staff:read` callers
// (admin / manager) keep the freeform query they've always had.
const RIDER_SCOPED_ROLES: UserRole[] = ['rider'];

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const role = request.nextUrl.searchParams.get('role');
      const requestedRoles = role ? [role] : [];

      const callerHasStaffRead = hasPermission(ctx.orgRole, 'staff:read');

      let effectiveRoles: string[];
      if (callerHasStaffRead) {
        // Admin / manager: any role filter (or none = everyone).
        effectiveRoles = requestedRoles;
      } else {
        // Non-staff caller (coach, etc.) — enforce the allowlist.
        // Refuse anything but `rider`. An empty filter is rejected too;
        // we will not leak the full roster to a `riders:read`-only role.
        if (
          requestedRoles.length === 0 ||
          requestedRoles.some((r) => !RIDER_SCOPED_ROLES.includes(r as UserRole))
        ) {
          return errorResponse(
            'FORBIDDEN',
            'staff:read permission required to list non-rider members.',
            403,
          );
        }
        effectiveRoles = requestedRoles;
      }

      const { page, pageSize } = parsePagination(request);

      const { items, total } = await getMembersByRole(ctx.clubId, effectiveRoles, {
        page,
        pageSize,
      });

      return paginatedListResponse(items, page, pageSize, total);
    },
    { requiredPermission: 'riders:read' },
  );
}
