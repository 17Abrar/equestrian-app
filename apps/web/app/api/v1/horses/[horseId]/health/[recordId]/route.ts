import { type NextRequest } from 'next/server';
import { deleteHealthRecord } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateUuidParam } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

interface RouteParams {
  params: Promise<{ horseId: string; recordId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    // Audit F-5 (2026-05-06): vets need `horses:update_medical` access
    // to amend a misfiled diagnosis on a health record. The previous
    // single-permission gate locked them out.
    const allowed =
      hasPermission(ctx.orgRole, 'horses:update') ||
      hasPermission(ctx.orgRole, 'horses:update_medical');
    if (!allowed) {
      return errorResponse(
        'FORBIDDEN',
        'You do not have permission to delete health records',
        403,
      );
    }

    const { horseId, recordId } = await params;
    validateUuidParam('horseId', horseId);
    validateUuidParam('recordId', recordId);
    const result = await deleteHealthRecord(ctx.clubId, horseId, recordId);

    if (!result) {
      return errorResponse('NOT_FOUND', 'Health record not found', 404);
    }

    void ctx.audit({
      action: 'health_record.delete',
      resourceType: 'health_record',
      resourceId: recordId,
    });

    return successResponse({ id: result.id });
  });
}
