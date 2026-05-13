import React from 'react';
import { type NextRequest, after } from 'next/server';
import { riderFiltersSchema, createRiderSchema } from '@equestrian/shared/schemas';
import {
  getRidersByClub,
  createRider,
  getClubById,
  ensureRiderProfilesForActiveRiderMembers,
} from '@equestrian/db/queries';
import {
  withAuth,
  paginatedResponse,
  successResponse,
  errorResponse,
  validateInput,
  parseRequiredBody,
} from '@/lib/api-utils';
import { logger } from '@/lib/logger';
import { sendTriggeredEmail } from '@/lib/email';
import { WelcomeRider } from '@equestrian/email-templates/welcome-rider';

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const searchParams = Object.fromEntries(request.nextUrl.searchParams);
      const filters = validateInput(riderFiltersSchema, searchParams);

      const repairedProfiles = await ensureRiderProfilesForActiveRiderMembers(ctx.clubId);
      if (repairedProfiles > 0) {
        logger.info('rider_profiles_backfilled_for_active_members', {
          clubId: ctx.clubId,
          repairedProfiles,
        });
      }

      const { data, total } = await getRidersByClub(ctx.clubId, filters);

      // Audit F-20 (2026-05-06 comprehensive): rider profiles include
      // decrypted medical notes (PHI) and emergency contact details.
      // Staff with `riders:read` (admin / manager / coach) legitimately
      // need the data, but the at-rest encryption layer doesn't tell us
      // WHO read it. Emit a coarse audit-log row per response so a
      // compromised coach token can't dump the roster's PHI without
      // leaving a trail. One row per request (not per record) keeps the
      // audit_log writable footprint bounded.
      const medicalNoteRowCount = data.filter((r) => r.medicalNotes != null).length;
      void ctx.audit({
        action: 'rider_medical_notes.list_accessed',
        resourceType: 'rider_list',
        changes: {
          page: { from: null, to: filters.page },
          pageSize: { from: null, to: filters.pageSize },
          rowsServed: { from: null, to: data.length },
          rowsWithMedicalNotes: { from: null, to: medicalNoteRowCount },
        },
      });

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
      // Audit F-63 (2026-05-07 r5).
      const data = await parseRequiredBody(request, createRiderSchema);

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
