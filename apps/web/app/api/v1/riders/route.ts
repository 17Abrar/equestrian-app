import React from 'react';
import { type NextRequest, after } from 'next/server';
import { riderFiltersSchema, createRiderSchema } from '@equestrian/shared/schemas';
import { getRidersByClub, createRider, getClubById } from '@equestrian/db/queries';
import {
  withAuth,
  paginatedResponse,
  successResponse,
  errorResponse,
  validateInput,
} from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { sendTriggeredEmail } from '@/lib/email';
import { WelcomeRider } from '@equestrian/email-templates/welcome-rider';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(riderFiltersSchema, searchParams);

      const { data, total } = await getRidersByClub(ctx.clubId, filters);

      return paginatedResponse(data, {
        page: filters.page,
        pageSize: filters.pageSize,
        total,
      });
    },
    { requiredPermission: 'riders:read' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const body = await request.json();
      const data = validateInput(createRiderSchema, body);

      const result = await createRider(ctx.clubId, data);

      if (!result) {
        return errorResponse('CREATE_FAILED', 'Failed to create rider', 500);
      }

      logger.info('rider_created', {
        memberId: result.member.id,
        profileId: result.profile?.id,
        clubId: ctx.clubId,
      });

      void ctx.audit({
        action: 'rider.create',
        resourceType: 'rider',
        resourceId: result.member.id,
        changes: {
          profileId: { from: null, to: result.profile?.id ?? null },
        },
      });

      // Post-response welcome email — `after()` keeps the task alive past
      // response flush on Cloudflare Workers.
      const riderEmail = result.member.email;
      if (riderEmail) {
        after(async () => {
          try {
            const club = await getClubById(ctx.clubId);
            await sendTriggeredEmail({
              clubId: ctx.clubId,
              trigger: 'rider_welcome',
              to: riderEmail,
              subject: `Welcome to ${club?.name ?? 'the club'}`,
              template: React.createElement(WelcomeRider, {
                riderName: result.member.displayName ?? '',
                clubName: club?.name ?? '',
              }),
            });
          } catch (err) {
            // Non-fatal for the request, but tag it for the alert rule.
            logger.error('email_send_failed', {
              trigger: 'rider_welcome',
              clubId: ctx.clubId,
              memberId: result.member.id,
              error: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
            });
          }
        });
      }

      return successResponse(result, 201);
    },
    { requiredPermission: 'riders:create' },
  );
}
