import { type NextRequest } from 'next/server';
import { type UserRole } from '@equestrian/shared/types';
import { getMembersByRole } from '@equestrian/db/queries';
import { userRoleEnum } from '@equestrian/db/schema';
import {
  withAuth,
  errorResponse,
  parsePagination,
  paginatedListResponse,
  validateInput,
} from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import { z } from 'zod';

// Audit HIGH-2 (2026-05-05 pass 2): the previous shape used a *blocklist*
// (`STAFF_ROLES`) — a coach with `riders:read` was rejected when probing
// `?role=club_admin` but slipped through with `?role=horse_owner` or
// `?role=parent`, harvesting the club's owner/parent roster including
// email + phone. Worse, an empty `role=` returned EVERY member. Switch
// to an *allowlist*: callers without `staff:read` are scoped to riders
// only — no role= and any non-`rider` value 403s. `staff:read` callers
// (admin / manager) keep the freeform query they've always had.
const RIDER_SCOPED_ROLES: UserRole[] = ['rider'];

// Audit F-7 (2026-05-08 r6): bind `?role=` to the `user_role` pgEnum's
// literal tuple so a typo (e.g. `?role=admin` vs `?role=club_admin`)
// surfaces as a 400 instead of bubbling to Postgres as
// `invalid input value for enum user_role` (500). The downstream
// `getMembersByRole` does `inArray(clubMembers.role, roles as ClubMemberRole[])`;
// the cast was nominal, Postgres still rejected at bind time.
const membersFiltersSchema = z
  .object({
    role: z.enum(userRoleEnum.enumValues).optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const rawRole = request.nextUrl.searchParams.get('role');
      const filters = validateInput(
        membersFiltersSchema,
        rawRole == null ? {} : { role: rawRole },
      );
      const requestedRoles = filters.role ? [filters.role] : [];

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
