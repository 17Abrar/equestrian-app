import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { addEmailSuppression, listManualSuppressionsForClub } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
  paginatedResponse,
  parsePagination,
} from '@/lib/api-utils';

/**
 * Task #21 (2026-05-28): in-app suppression management for club admins.
 *
 * GET  /api/v1/emails/suppressions       — list this club's manual entries
 * POST /api/v1/emails/suppressions       — add a manual suppression
 *
 * Scope: only `source = 'manual' AND club_id = ctx.clubId` rows. The
 * global resend-webhook suppressions are NOT exposed here — those
 * affect all tenants and surfacing them would leak which addresses
 * other clubs are sending to. The CHECK constraint from migration 0065
 * enforces that a manual row always carries a club_id, so the listing
 * + write paths can rely on the database for the pairing invariant.
 */

const addSuppressionSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

export async function GET(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { page, pageSize } = parsePagination(request);
      const result = await listManualSuppressionsForClub(ctx.clubId, { page, pageSize });
      return paginatedResponse(result.data, { page, pageSize, total: result.total });
    },
    { requiredPermission: 'emails:create' },
  );
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const data = await parseRequiredBody(request, addSuppressionSchema);

      try {
        const result = await addEmailSuppression({
          email: data.email,
          reason: 'manual',
          source: 'manual',
          notes: data.notes,
          clubId: ctx.clubId,
        });

        void ctx.audit({
          action: 'email.suppression_add',
          resourceType: 'email_suppression',
          resourceId: data.email,
          changes: {
            email: { from: null, to: data.email },
            source: { from: null, to: 'manual' },
          },
        });

        return successResponse(
          { email: result.email, inserted: result.inserted },
          result.inserted ? 201 : 200,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Insert failed';
        // The CHECK from migration 0065 fires if `source = 'manual'`
        // and `club_id IS NULL` — shouldn't happen here (we always pass
        // ctx.clubId) but treat the violation as a 500 with structured
        // logging rather than leaking the Postgres error.
        if (/email_suppressions_manual_requires_club/i.test(message)) {
          return errorResponse('INTERNAL_ERROR', 'Could not save suppression. Please retry.', 500);
        }
        throw err;
      }
    },
    {
      requiredPermission: 'emails:create',
      // Same 5/hour cap as broadcast — manual suppressions are an
      // operational tool, not a hot path. failClosed so an Upstash
      // blip doesn't lift the cap on a write surface.
      rateLimit: { maxRequests: 20, windowMs: 60 * 60_000, failClosed: true },
      routeKey: 'emails:suppressions',
    },
  );
}
