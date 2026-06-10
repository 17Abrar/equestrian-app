import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { listEmailSendsForClub } from '@equestrian/db/queries';
import type { EmailSendSource, EmailSendStatus } from '@equestrian/db/schema';
import { withAuth, paginatedResponse, parsePagination, errorResponse } from '@/lib/api-utils';

/**
 * Task #22 (2026-05-28): GET /api/v1/emails/sends — paginated send-log
 * listing for the in-app "Recently sent" tab.
 *
 * Optional filters:
 *   - status: queued | sent | failed | suppressed
 *   - source: manual_single | manual_broadcast | transactional
 */

const STATUS_VALUES = ['queued', 'sent', 'failed', 'suppressed'] as const;
const SOURCE_VALUES = ['manual_single', 'manual_broadcast', 'transactional'] as const;

const statusSchema = z.enum(STATUS_VALUES).optional();
const sourceSchema = z.enum(SOURCE_VALUES).optional();

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { page, pageSize } = parsePagination(request);
      const url = new URL(request.url);

      const statusParsed = statusSchema.safeParse(url.searchParams.get('status') ?? undefined);
      const sourceParsed = sourceSchema.safeParse(url.searchParams.get('source') ?? undefined);
      if (!statusParsed.success || !sourceParsed.success) {
        return errorResponse('VALIDATION_ERROR', 'Invalid status or source filter', 400);
      }

      const result = await listEmailSendsForClub({
        clubId: ctx.clubId,
        status: statusParsed.data as EmailSendStatus | undefined,
        source: sourceParsed.data as EmailSendSource | undefined,
        page,
        pageSize,
      });

      return paginatedResponse(result.data, { page, pageSize, total: result.total });
    },
    { requiredPermission: 'emails:create' },
  );
}
