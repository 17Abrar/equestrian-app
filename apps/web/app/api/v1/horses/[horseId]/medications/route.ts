import { type NextRequest } from 'next/server';
import { createMedicationSchema } from '@equestrian/shared/schemas';
import { getMedications, createMedication } from '@equestrian/db/queries';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const activeOnly = request.nextUrl.searchParams.get('activeOnly') === 'true';
      const medications = await getMedications(ctx.clubId, horseId, activeOnly);
      return successResponse(medications);
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const body = await request.json();
      const data = validateInput(createMedicationSchema, body);
      const medication = await createMedication(ctx.clubId, horseId, data);
      return successResponse(medication, 201);
    },
    { requiredPermission: 'horses:update' },
  );
}
