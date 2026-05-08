import { type NextRequest } from 'next/server';
import { getMemberByIdIncludingDeactivated, updateMember, deactivateMember } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseRequiredBody, validateUuidParam } from '@/lib/api-utils';
import { updateOwnerSchema } from '@equestrian/shared/schemas';

interface RouteParams {
  params: Promise<{ memberId: string }>;
}

/**
 * Resolves a member by id and refuses to act on it if it isn't a horse_owner —
 * audit A-1. The owners route is sister to the staff route, which has its own
 * `assertAdminGuards` helper preventing managers from deactivating the last
 * `club_admin`. Without the role gate here, a manager could route through this
 * endpoint to rename or deactivate an admin row, bypassing those guards and
 * mis-filing the audit entry under `owner.*` rather than `staff.*`.
 */
async function loadOwnerOrError(clubId: string, memberId: string) {
  const member = await getMemberByIdIncludingDeactivated(clubId, memberId);
  if (!member) {
    return { member: null, error: errorResponse('NOT_FOUND', 'Owner not found', 404) };
  }
  if (member.role !== 'horse_owner') {
    return {
      member: null,
      error: errorResponse(
        'WRONG_RESOURCE',
        'This member is not a horse owner — use the staff endpoint',
        404,
      ),
    };
  }
  return { member, error: null };
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { memberId } = await params;
      validateUuidParam('memberId', memberId);
      const { member, error } = await loadOwnerOrError(ctx.clubId, memberId);
      if (error) return error;
      return successResponse(member);
    },
    { requiredPermission: 'owners:read' },
  );
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { memberId } = await params;
      validateUuidParam('memberId', memberId);
      const { error } = await loadOwnerOrError(ctx.clubId, memberId);
      if (error) return error;

      const data = await parseRequiredBody(request, updateOwnerSchema);

      const member = await updateMember(ctx.clubId, memberId, data);

      if (!member) {
        return errorResponse('NOT_FOUND', 'Owner not found', 404);
      }

      void ctx.audit({
        action: 'owner.update',
        resourceType: 'owner',
        resourceId: memberId,
      });

      return successResponse(member);
    },
    { requiredPermission: 'owners:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { memberId } = await params;
      validateUuidParam('memberId', memberId);
      const { error } = await loadOwnerOrError(ctx.clubId, memberId);
      if (error) return error;

      const result = await deactivateMember(ctx.clubId, memberId);

      if (!result) {
        return errorResponse('NOT_FOUND', 'Owner not found', 404);
      }

      void ctx.audit({
        action: 'owner.deactivate',
        resourceType: 'owner',
        resourceId: memberId,
      });

      return successResponse({ id: result.id, message: 'Owner deactivated' });
    },
    { requiredPermission: 'owners:delete' },
  );
}
