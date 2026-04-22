import { type NextRequest } from 'next/server';
import { createHealthRecordSchema } from '@equestrian/shared/schemas';
import { getHealthRecords, createHealthRecord } from '@equestrian/db/queries';
import { toMinorUnits } from '@equestrian/shared/utils';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const recordType = request.nextUrl.searchParams.get('recordType') ?? undefined;
      const records = await getHealthRecords(ctx.clubId, horseId, recordType);
      return successResponse(records);
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const body = await request.json();
      const data = validateInput(createHealthRecordSchema, body);

      const record = await createHealthRecord(ctx.clubId, horseId, {
        ...data,
        cost: data.cost != null ? toMinorUnits(data.cost) : undefined,
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
    { requiredPermission: 'horses:update' },
  );
}
