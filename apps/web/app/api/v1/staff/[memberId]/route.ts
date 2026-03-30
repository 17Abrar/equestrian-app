import { type NextRequest } from 'next/server';
import { updateStaffSchema } from '@equestrian/shared/schemas';
import { getMemberById, updateMember, deactivateMember } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ memberId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { memberId } = await params;
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
      const body = await request.json();
      const data = validateInput(updateStaffSchema, body);

      const member = await updateMember(ctx.clubId, memberId, data);

      if (!member) {
        return errorResponse('NOT_FOUND', 'Staff member not found', 404);
      }

      return successResponse(member);
    },
    { requiredPermission: 'staff:update' },
  );
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { memberId } = await params;
      const result = await deactivateMember(ctx.clubId, memberId);

      if (!result) {
        return errorResponse('NOT_FOUND', 'Staff member not found', 404);
      }

      return successResponse({ id: result.id, message: 'Staff member deactivated' });
    },
    { requiredPermission: 'staff:delete' },
  );
}
