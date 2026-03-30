import { type NextRequest } from 'next/server';
import { createMedicationLogSchema } from '@equestrian/shared/schemas';
import { getMedicationLogs, createMedicationLog } from '@equestrian/db/queries';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';

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
      const body = await request.json();
      const data = validateInput(createMedicationLogSchema, body);

      const log = await createMedicationLog(ctx.clubId, horseId, {
        ...data,
        medicationId,
        administeredAt: new Date(data.administeredAt),
        administeredByMemberId: data.administeredByMemberId ?? ctx.memberId,
      });

      return successResponse(log, 201);
    },
    { requiredPermission: 'horses:update_care' },
  );
}
