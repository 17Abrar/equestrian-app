import { type NextRequest } from 'next/server';
import { createMedicationLogSchema } from '@equestrian/shared/schemas';
import {
  getMedicationLogs,
  createMedicationLog,
  getMedicationByIds,
} from '@equestrian/db/queries';
import { withAuth, successResponse, errorResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string; medicationId: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, medicationId } = await params;
      const logs = await getMedicationLogs(ctx.clubId, horseId, medicationId);
      return successResponse(logs);
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, medicationId } = await params;

      // Verify the medication actually belongs to (this club, this horse).
      // Path params alone aren't trustworthy — the medication FK references
      // horse_medications(id) only, so without this check a caller could log
      // doses against a foreign club's medication.
      const medication = await getMedicationByIds(ctx.clubId, horseId, medicationId);
      if (!medication) {
        return errorResponse('NOT_FOUND', 'Medication not found for this horse', 404);
      }

      const body = await request.json();
      const data = validateInput(createMedicationLogSchema, body);

      const log = await createMedicationLog(ctx.clubId, horseId, {
        ...data,
        medicationId,
        administeredAt: new Date(data.administeredAt),
        administeredByMemberId: data.administeredByMemberId ?? ctx.memberId,
      });

      if (log) {
        void ctx.audit({
          action: 'medication_log.create',
          resourceType: 'medication_log',
          resourceId: log.id,
          changes: {
            horseId: { from: null, to: horseId },
            medicationId: { from: null, to: medicationId },
          },
        });
      }

      return successResponse(log, 201);
    },
    { requiredPermission: 'horses:update_care' },
  );
}
