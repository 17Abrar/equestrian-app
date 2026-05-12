import { type NextRequest } from 'next/server';
import { createMedicationSchema } from '@equestrian/shared/schemas';
import { getMedications, createMedication, getHorseById } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  parsePagination,
  paginatedListResponse,
  validateUuidParam,
} from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      // Audit pass-3 (2026-05-09): medications are clinical PHI — see
      // sibling health/route.ts GET. Coach + groom hold `horses:read`
      // but should not enumerate drug regimens. Vet role and admins
      // are admitted via `horses:read_medical` / `horses:update_medical`
      // / `horses:update`.
      const allowed =
        hasPermission(ctx.orgRole, 'horses:read_medical') ||
        hasPermission(ctx.orgRole, 'horses:update_medical') ||
        hasPermission(ctx.orgRole, 'horses:update');
      if (!allowed) {
        return errorResponse(
          'FORBIDDEN',
          'You do not have permission to read horse medications',
          403,
        );
      }

      const { horseId } = await params;
      validateUuidParam('horseId', horseId);
      const activeOnly = request.nextUrl.searchParams.get('activeOnly') === 'true';
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await getMedications(ctx.clubId, horseId, activeOnly, {
        page,
        pageSize,
      });
      return paginatedListResponse(items, page, pageSize, total);
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    // Audit F-5 (2026-05-06): vets (`horses:update_medical`) legitimately
    // create medications; the previous single-permission gate would
    // 403 them out of the workflow the role label promised them.
    const allowed =
      hasPermission(ctx.orgRole, 'horses:update') ||
      hasPermission(ctx.orgRole, 'horses:update_medical');
    if (!allowed) {
      return errorResponse('FORBIDDEN', 'You do not have permission to create medications', 403);
    }

    const { horseId } = await params;
    validateUuidParam('horseId', horseId);

    // Bind the horse to this tenant before insert. The horse_medications.horse_id
    // FK references horses(id) only — without this guard a member of Club B with
    // horses:update could POST against a Club A horseId and write a row with
    // (club_id=B, horse_id=A's-horse), polluting both tenants' data.
    const horse = await getHorseById(ctx.clubId, horseId);
    if (!horse) {
      return errorResponse('NOT_FOUND', 'Horse not found', 404);
    }

    const data = await parseRequiredBody(request, createMedicationSchema);
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
  });
}
