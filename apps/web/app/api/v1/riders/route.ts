import React from 'react';
import { type NextRequest } from 'next/server';
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
import { sendTriggeredEmailAsync } from '@/lib/email';
import { WelcomeRider } from '@equestrian/email-templates/welcome-rider';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = riderFiltersSchema.parse(searchParams);

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

      // Fire-and-forget welcome email — does not block the response
      const riderEmail = result.member.email;
      if (riderEmail) {
        void getClubById(ctx.clubId).then((club) => {
          sendTriggeredEmailAsync({
            clubId: ctx.clubId,
            trigger: 'rider_welcome',
            to: riderEmail,
            subject: `Welcome to ${club?.name ?? 'the club'}`,
            template: React.createElement(WelcomeRider, {
              riderName: result.member.displayName ?? '',
              clubName: club?.name ?? '',
            }),
          });
        }).catch(() => {
          // Email failure is non-fatal — already logged inside sendEmailAsync
        });
      }

      return successResponse(result, 201);
    },
    { requiredPermission: 'riders:create' },
  );
}
