import { type NextRequest } from 'next/server';
import { paginationSchema } from '@equestrian/shared/schemas';
import { type UserRole } from '@equestrian/shared/types';
import { getMembersByRole } from '@equestrian/db/queries';
import {
  withAuth,
  errorResponse,
  paginatedResponse,
  validateInput,
} from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

// Listing staff requires staff:read. Without this, riders/parents/owners
// holding `riders:read` could enumerate club_admins by passing
// `?role=club_admin`. Audit AI-21.
const STAFF_ROLES: UserRole[] = [
  'club_admin',
  'club_manager',
  'coach',
  'groom',
  'veterinarian',
];

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const role = request.nextUrl.searchParams.get('role');
      const roles = role ? [role] : [];

      const wantsStaff = roles.some((r) => STAFF_ROLES.includes(r as UserRole));
      if (wantsStaff && !hasPermission(ctx.orgRole, 'staff:read')) {
        return errorResponse(
          'FORBIDDEN',
          'staff:read permission required to list staff members.',
          403,
        );
      }

      const { page, pageSize } = validateInput(paginationSchema, {
        page: request.nextUrl.searchParams.get('page') ?? undefined,
        pageSize: request.nextUrl.searchParams.get('pageSize') ?? undefined,
      });

      const { items, total } = await getMembersByRole(ctx.clubId, roles, { page, pageSize });

      return paginatedResponse(items, { page, pageSize, total });
    },
    { requiredPermission: 'riders:read' },
  );
}
