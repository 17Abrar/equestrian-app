import { type NextRequest } from 'next/server';
import { updateMedicationSchema } from '@equestrian/shared/schemas';
import { updateMedication } from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, parseRequiredBody, validateUuidParam } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

interface RouteParams {
  params: Promise<{ horseId: string; medicationId: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    // Audit F-5 (2026-05-06): admin/manager (`horses:update`) and
    // veterinarian (`horses:update_medical`) both legitimately edit
    // medications. The previous single-permission gate locked vets
    // out of routes the role labels imply they own.
    const allowed =
      hasPermission(ctx.orgRole, 'horses:update') ||
      hasPermission(ctx.orgRole, 'horses:update_medical');
    if (!allowed) {
      return errorResponse(
        'FORBIDDEN',
        'You do not have permission to update medications',
        403,
      );
    }

    const { horseId, medicationId } = await params;
    validateUuidParam('horseId', horseId);
    validateUuidParam('medicationId', medicationId);
    const data = await parseRequiredBody(request, updateMedicationSchema);
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
  });
}
