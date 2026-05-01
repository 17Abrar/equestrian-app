import { type NextRequest } from 'next/server';
import { createMedicationSchema, paginationSchema } from '@equestrian/shared/schemas';
import { getMedications, createMedication, getHorseById } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
  paginatedResponse,
} from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const activeOnly = request.nextUrl.searchParams.get('activeOnly') === 'true';
      const { page, pageSize } = validateInput(paginationSchema, {
        page: request.nextUrl.searchParams.get('page') ?? undefined,
        pageSize: request.nextUrl.searchParams.get('pageSize') ?? undefined,
      });
      const { items, total } = await getMedications(ctx.clubId, horseId, activeOnly, {
        page,
        pageSize,
      });
      return paginatedResponse(items, { page, pageSize, total });
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;

      // Bind the horse to this tenant before insert. The horse_medications.horse_id
      // FK references horses(id) only — without this guard a member of Club B with
      // horses:update could POST against a Club A horseId and write a row with
      // (club_id=B, horse_id=A's-horse), polluting both tenants' data.
      const horse = await getHorseById(ctx.clubId, horseId);
      if (!horse) {
        return errorResponse('NOT_FOUND', 'Horse not found', 404);
      }

      const body = await request.json();
      const data = validateInput(createMedicationSchema, body);
      const medication = await createMedication(ctx.clubId, horseId, data);

      if (medication) {
        void ctx.audit({
          action: 'medication.create',
          resourceType: 'medication',
          resourceId: medication.id,
          changes: {
            horseId: { from: null, to: horseId },
          },
        });
      }

      return successResponse(medication, 201);
    },
    { requiredPermission: 'horses:update' },
  );
}
