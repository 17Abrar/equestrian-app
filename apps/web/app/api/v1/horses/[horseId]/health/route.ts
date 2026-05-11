import { type NextRequest } from 'next/server';
import { createHealthRecordSchema } from '@equestrian/shared/schemas';
import {
  getClubById,
  getHealthRecords,
  createHealthRecord,
  getHorseById,
} from '@equestrian/db/queries';
import { toMinorUnits } from '@equestrian/shared/utils';
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
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      // Audit pass-3 (2026-05-09): health records are clinical PHI.
      // Previously gated on the broad `horses:read` which coach + groom
      // hold — meaning a groom could iterate every horse in the club
      // and exfiltrate surgery history, lameness records, drug logs.
      // Mirrors the POST gate at line 45-47 (vet OR admin can write,
      // vet OR admin OR `horses:read_medical` holder can read). Decode-
      // path side: the POST flow trusts `horses:update_medical` to
      // imply "may also read" because a writer who can't audit their
      // own writes is meaningless.
      const allowed =
        hasPermission(ctx.orgRole, 'horses:read_medical') ||
        hasPermission(ctx.orgRole, 'horses:update_medical') ||
        hasPermission(ctx.orgRole, 'horses:update');
      if (!allowed) {
        return errorResponse(
          'FORBIDDEN',
          'You do not have permission to read horse health records',
          403,
        );
      }

      const { horseId } = await params;
      validateUuidParam('horseId', horseId);
      const recordType = request.nextUrl.searchParams.get('recordType') ?? undefined;
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await getHealthRecords(ctx.clubId, horseId, recordType, {
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
      // Audit r5 F-12 (2026-05-07): the `veterinarian` role holds
      // `horses:update_medical` (not `horses:update`); without the OR-gate
      // a vet onboarded via `manageStaff` would 403 from creating health
      // records — the role's core duty. The natural-but-wrong fix would
      // be to lower this to `horses:update_care`, which silently grants
      // grooms write access to medical history. Mirrors the equivalent
      // gate in `health/[recordId]/route.ts` and `medications/route.ts`.
      const allowed =
        hasPermission(ctx.orgRole, 'horses:update') ||
        hasPermission(ctx.orgRole, 'horses:update_medical');
      if (!allowed) {
        return errorResponse(
          'FORBIDDEN',
          'You do not have permission to create health records',
          403,
        );
      }

      const { horseId } = await params;
      validateUuidParam('horseId', horseId);

      // Bind the horse to this tenant before insert — see medications/route.ts
      // for the cross-tenant write scenario this guards against.
      const horse = await getHorseById(ctx.clubId, horseId);
      if (!horse) {
        return errorResponse('NOT_FOUND', 'Horse not found', 404);
      }

      const data = await parseRequiredBody(request, createHealthRecordSchema);

      // Health records have no currency field — they ride the club's currency.
      // Scale by it so KWD/BHD clubs (3-decimal) don't get silently 10×ed.
      let costMinor: number | undefined;
      if (data.cost != null) {
        const club = await getClubById(ctx.clubId);
        if (!club) {
          return errorResponse('NOT_FOUND', 'Club not found', 404);
        }
        costMinor = toMinorUnits(data.cost, club.currency);
      }

      const record = await createHealthRecord(ctx.clubId, horseId, {
        ...data,
        cost: costMinor,
        createdByMemberId: ctx.memberId,
      });

      logger.info('health_record_created', {
        recordId: record?.id,
        horseId,
        clubId: ctx.clubId,
        type: data.recordType,
      });

      if (record) {
        void ctx.audit({
          action: 'health_record.create',
          resourceType: 'health_record',
          resourceId: record.id,
          changes: {
            horseId: { from: null, to: horseId },
            recordType: { from: null, to: data.recordType },
          },
        });
      }

      return successResponse(record, 201);
    },
    // Audit r5 F-12 (2026-05-07): permission gate is inline above —
    // accepts horses:update OR horses:update_medical. Don't restore a
    // wrapper-level `requiredPermission` here without re-merging.
  );
}
