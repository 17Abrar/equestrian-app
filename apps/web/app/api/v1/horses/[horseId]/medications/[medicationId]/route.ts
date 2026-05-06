import { type NextRequest } from 'next/server';
import { updateMedicationSchema } from '@equestrian/shared/schemas';
import { updateMedication } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput, validateUuidParam } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string; medicationId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, medicationId } = await params;
      validateUuidParam('horseId', horseId);
      validateUuidParam('medicationId', medicationId);
      const body = await request.json();
      const data = validateInput(updateMedicationSchema, body);
      const medication = await updateMedication(ctx.clubId, horseId, medicationId, data);

      if (!medication) {
        return errorResponse('NOT_FOUND', 'Medication not found', 404);
      }

      void ctx.audit({
        action: 'medication.update',
        resourceType: 'medication',
        resourceId: medicationId,
      });

      return successResponse(medication);
    },
    { requiredPermission: 'horses:update' },
  );
}
