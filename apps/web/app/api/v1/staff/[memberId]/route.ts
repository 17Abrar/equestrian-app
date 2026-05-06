import { type NextRequest } from 'next/server';
import { updateStaffSchema } from '@equestrian/shared/schemas';
import {
  countActiveAdmins,
  deactivateMember,
  getMemberById,
  updateMember,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput, validateUuidParam } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ memberId: string }>;
}

/**
 * Guard against losing the last admin. `staff:*` is held by `club_manager`
 * via wildcard, so without explicit checks a manager could deactivate or
 * demote the only `club_admin` and lock everyone out of admin operations
 * with no in-app recovery path.
 *
 * Two rules:
 *  1. Only an admin may modify another admin (manager → admin is always 403).
 *  2. Even an admin cannot drop the count of active admins to zero.
 */
async function assertAdminGuards(opts: {
  clubId: string;
  callerRole: string;
  target: { role: string; isActive: boolean };
  willStillBeActiveAdmin: boolean;
}): Promise<{ error: { code: string; message: string; status: number } } | null> {
  const targetIsAdmin = opts.target.role === 'club_admin';
  if (!targetIsAdmin) return null;

  if (opts.callerRole !== 'club_admin') {
    return {
      error: {
        code: 'FORBIDDEN',
        message: 'Only a club admin can modify another club admin',
        status: 403,
      },
    };
  }

  if (opts.target.isActive && !opts.willStillBeActiveAdmin) {
    const active = await countActiveAdmins(opts.clubId);
    if (active <= 1) {
      return {
        error: {
          code: 'LAST_ADMIN',
          message: 'Cannot demote or deactivate the only active club admin',
          status: 409,
        },
      };
    }
  }

  return null;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { memberId } = await params;
      validateUuidParam('memberId', memberId);
      const member = await getMemberById(ctx.clubId, memberId);

      if (!member) {
        return errorResponse('NOT_FOUND', 'Staff member not found', 404);
      }

      return successResponse(member);
    },
    { requiredPermission: 'staff:read' },
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { memberId } = await params;
      validateUuidParam('memberId', memberId);
      const body = await request.json();
      const data = validateInput(updateStaffSchema, body);

      const target = await getMemberById(ctx.clubId, memberId);
      if (!target) {
        return errorResponse('NOT_FOUND', 'Staff member not found', 404);
      }

      // `updateStaffSchema.role` is `'club_manager' | 'coach' | 'groom'`
      // (admins can't be created/promoted via this route). So if the body
      // includes a role at all, it's a demotion away from admin. If the
      // body omits role, the existing admin-ness is preserved.
      const willStillBeActiveAdmin = data.role === undefined && target.isActive;
      const guard = await assertAdminGuards({
        clubId: ctx.clubId,
        callerRole: ctx.orgRole,
        target,
        willStillBeActiveAdmin,
      });
      if (guard) {
        return errorResponse(guard.error.code, guard.error.message, guard.error.status);
      }

      const member = await updateMember(ctx.clubId, memberId, data);

      if (!member) {
        return errorResponse('NOT_FOUND', 'Staff member not found', 404);
      }

      void ctx.audit({
        action: 'staff.update',
        resourceType: 'club_member',
        resourceId: memberId,
      });

      return successResponse(member);
    },
    { requiredPermission: 'staff:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { memberId } = await params;
      validateUuidParam('memberId', memberId);

      const target = await getMemberById(ctx.clubId, memberId);
      if (!target) {
        return errorResponse('NOT_FOUND', 'Staff member not found', 404);
      }

      // Deactivation drops the active count by 1, so for an admin target
      // the post-state is "no longer an active admin".
      const guard = await assertAdminGuards({
        clubId: ctx.clubId,
        callerRole: ctx.orgRole,
        target,
        willStillBeActiveAdmin: false,
      });
      if (guard) {
        return errorResponse(guard.error.code, guard.error.message, guard.error.status);
      }

      const result = await deactivateMember(ctx.clubId, memberId);

      if (!result) {
        return errorResponse('NOT_FOUND', 'Staff member not found', 404);
      }

      void ctx.audit({
        action: 'staff.deactivate',
        resourceType: 'club_member',
        resourceId: memberId,
      });

      return successResponse({ id: result.id, message: 'Staff member deactivated' });
    },
    { requiredPermission: 'staff:delete' },
  );
}
