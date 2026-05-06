import { type NextRequest } from 'next/server';
import { deleteHealthRecord } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateUuidParam } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string; recordId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
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
    },
    { requiredPermission: 'horses:update' },
  );
}
