import { type NextRequest } from 'next/server';
import { deleteDocument } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateUuidParam } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

interface RouteParams {
  params: Promise<{ horseId: string; documentId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    // Audit F-5 (2026-05-06): grooms / vets can delete care or
    // medical documents they uploaded. Mirrors the create gate.
    const allowed =
      hasPermission(ctx.orgRole, 'horses:update') ||
      hasPermission(ctx.orgRole, 'horses:update_care') ||
      hasPermission(ctx.orgRole, 'horses:update_medical');
    if (!allowed) {
      return errorResponse(
        'FORBIDDEN',
        'You do not have permission to delete horse documents',
        403,
      );
    }

    const { horseId, documentId } = await params;
    validateUuidParam('horseId', horseId);
    validateUuidParam('documentId', documentId);
    const result = await deleteDocument(ctx.clubId, horseId, documentId);

    if (!result) {
      return errorResponse('NOT_FOUND', 'Document not found', 404);
    }

    void ctx.audit({
      action: 'horse_document.delete',
      resourceType: 'horse_document',
      resourceId: documentId,
      changes: {
        horseId: { from: null, to: horseId },
      },
    });

    return successResponse({ id: result.id });
  });
}
