import { type NextRequest } from 'next/server';
import { createMedicationLogSchema, paginationSchema } from '@equestrian/shared/schemas';
import {
  getMedicationLogs,
  createMedicationLog,
  getMedicationByIds,
  getMemberById,
} from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
  paginatedResponse,
} from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string; medicationId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, medicationId } = await params;
      const { page, pageSize } = validateInput(paginationSchema, {
        page: request.nextUrl.searchParams.get('page') ?? undefined,
        pageSize: request.nextUrl.searchParams.get('pageSize') ?? undefined,
      });
      const { items, total } = await getMedicationLogs(ctx.clubId, horseId, medicationId, {
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

      // Mass-assignment guard (audit AI-19). The body's optional
      // administeredByMemberId is a UUID — without verification a caller
      // could log doses against any UUID, which doesn't compromise
      // tenant isolation today (the FK references club_members(id) which
      // is global, but is only displayed scoped to this club) but would
      // attribute the dose to the wrong member if they happen to be in
      // another club. Force ctx.memberId unless the supplied UUID
      // matches an active member of this club.
      let administeredByMemberId: string | null | undefined =
        ctx.memberId;
      if (data.administeredByMemberId) {
        const member = await getMemberById(ctx.clubId, data.administeredByMemberId);
        if (!member || !member.isActive) {
          return errorResponse(
            'INVALID_MEMBER',
            'administeredByMemberId is not an active member of this club',
            422,
          );
        }
        administeredByMemberId = member.id;
      }

      const log = await createMedicationLog(ctx.clubId, horseId, {
        ...data,
        medicationId,
        administeredAt: new Date(data.administeredAt),
        administeredByMemberId,
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
