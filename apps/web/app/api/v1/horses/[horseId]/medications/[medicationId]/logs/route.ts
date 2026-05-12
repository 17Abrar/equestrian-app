import { type NextRequest } from 'next/server';
import { createMedicationLogSchema } from '@equestrian/shared/schemas';
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
  parseRequiredBody,
  parsePagination,
  paginatedListResponse,
  validateUuidParam,
} from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

interface RouteParams {
  params: Promise<{ horseId: string; medicationId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      // Audit pass-3 (2026-05-09): medication logs include `notes` and
      // `skip_reason` (encrypted-at-rest under MEDICATION_LOG_ENCRYPTED_
      // FIELDS — audit F-2 closure). Treating dose history as broadly-
      // readable defeats the encryption invariant. Admit clinical roles
      // (vet, admin) AND `horses:update_care` (grooms doing dose admin
      // who need to see what they've already given today). If a future
      // workflow needs a non-care, non-clinical reader, grant
      // `horses:read_medical` rather than relaxing this gate.
      const allowed =
        hasPermission(ctx.orgRole, 'horses:read_medical') ||
        hasPermission(ctx.orgRole, 'horses:update_medical') ||
        hasPermission(ctx.orgRole, 'horses:update') ||
        hasPermission(ctx.orgRole, 'horses:update_care');
      if (!allowed) {
        return errorResponse(
          'FORBIDDEN',
          'You do not have permission to read medication logs',
          403,
        );
      }

      const { horseId, medicationId } = await params;
      validateUuidParam('horseId', horseId);
      validateUuidParam('medicationId', medicationId);
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await getMedicationLogs(ctx.clubId, horseId, medicationId, {
        page,
        pageSize,
      });
      return paginatedListResponse(items, page, pageSize, total);
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId, medicationId } = await params;
      validateUuidParam('horseId', horseId);
      validateUuidParam('medicationId', medicationId);

      // Verify the medication actually belongs to (this club, this horse).
      // Path params alone aren't trustworthy — the medication FK references
      // horse_medications(id) only, so without this check a caller could log
      // doses against a foreign club's medication.
      const medication = await getMedicationByIds(ctx.clubId, horseId, medicationId);
      if (!medication) {
        return errorResponse('NOT_FOUND', 'Medication not found for this horse', 404);
      }

      const data = await parseRequiredBody(request, createMedicationLogSchema);

      // Mass-assignment guard (audit QA-19). The body's optional
      // administeredByMemberId is a UUID — without verification a caller
      // could log doses against any UUID, which doesn't compromise
      // tenant isolation today (the FK references club_members(id) which
      // is global, but is only displayed scoped to this club) but would
      // attribute the dose to the wrong member if they happen to be in
      // another club. Force ctx.memberId unless the supplied UUID
      // matches an active member of this club.
      let administeredByMemberId: string | null | undefined = ctx.memberId;
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
