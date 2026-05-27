import { type NextRequest } from 'next/server';
import { bulkCreateHorsesSchema } from '@equestrian/shared/schemas';
import { createHorse } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  parseRequiredBody,
} from '@/lib/api-utils';
import { findNonR2OriginUrl } from '@/lib/upload-verify-cache';
import { logger } from '@/lib/logger';

/**
 * POST /api/v1/horses/bulk — bulk-create horses from a parsed CSV.
 *
 * Feature 2026-05-27 (user request). The client parses an admin-
 * uploaded CSV, displays a preview with per-row validation, and
 * POSTs the accepted rows here. The server re-validates each row
 * against `createHorseSchema` (so a tampered client can't bypass
 * row-level checks) and creates horses one at a time, returning a
 * per-row result.
 *
 * Partial success by design: a single bad row (e.g., duplicate
 * microchip) shouldn't block the other 99. The response includes
 * `{successCount, failureCount, results: [{success, id?, error?}]}`
 * so the UI can surface which rows failed without forcing a retry
 * of everything.
 *
 * Photo URLs: any `primaryPhotoUrl` / `photoUrls` values must pass
 * the same R2-origin pin as single-horse POST (audit pass-5 MED-1).
 * In practice the bulk template doesn't include photo columns; this
 * gate is here defensively.
 *
 * Rate limit: 5/hour/club. Bulk import is a one-time onboarding
 * action; we don't expect repeats.
 */
export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const data = await parseRequiredBody(request, bulkCreateHorsesSchema);

      // R2-origin pin for any photo URLs (same as POST /horses, audit
      // pass-5 MED-1). Most bulk rows won't include photos but a
      // tampered CSV could carry external URLs.
      const photoUrls = data.horses.flatMap((h) => {
        const urls: string[] = [];
        if (h.primaryPhotoUrl) urls.push(h.primaryPhotoUrl);
        if (h.photoUrls) urls.push(...h.photoUrls);
        return urls;
      });
      const rejected = findNonR2OriginUrl(photoUrls);
      if (rejected) {
        return errorResponse(
          'INVALID_PHOTO_URL',
          'Photo URLs must come from /api/v1/upload — strip photo columns and add images per-horse after import.',
          400,
        );
      }

      type RowResult =
        | { success: true; index: number; csvRow: number; id: string; name: string }
        | { success: false; index: number; csvRow: number; name: string; error: string };

      const results: RowResult[] = [];
      let successCount = 0;
      let failureCount = 0;

      for (let i = 0; i < data.horses.length; i += 1) {
        const row = data.horses[i];
        if (!row) continue;
        // Echo back the original CSV row number so the post-import
        // view points the operator at the right line in their
        // spreadsheet — even after the client filtered out invalid
        // rows before submit. Codex P3 (2026-05-27).
        const csvRow = data.csvRowNumbers?.[i] ?? i + 2;
        try {
          const created = await createHorse(ctx.clubId, row);
          if (!created) {
            failureCount += 1;
            results.push({
              success: false,
              index: i,
              csvRow,
              name: row.name,
              error: 'Database returned no row',
            });
            continue;
          }
          successCount += 1;
          results.push({
            success: true,
            index: i,
            csvRow,
            id: created.id,
            name: created.name,
          });
          void ctx.audit({
            action: 'horse.bulk_import_create',
            resourceType: 'horse',
            resourceId: created.id,
            changes: {
              name: { from: null, to: created.name },
              csvRow: { from: null, to: csvRow },
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Insert failed';
          // Distinguish ROW-level errors (the admin can fix in their
          // CSV) from INFRASTRUCTURE errors (DB outage, missing
          // encryption key, etc.). Codex P2 (2026-05-28): a broad
          // catch that wrapped everything as a per-row failure would
          // mask a 5xx situation — admin gets "all rows failed",
          // monitoring sees a 200, and we lose the alert.
          //
          // Known row-level patterns: duplicate-key, FK violation
          // on a body-supplied id (owner/club already filtered out
          // by withAuth), invalid date string. Anything else is
          // re-thrown to surface as a 500.
          const isRowLevel =
            /duplicate key|unique constraint/i.test(message) ||
            /violates foreign key/i.test(message) ||
            // Date errors come in two flavors from Postgres: syntax
            // (`2026-13-99` → "invalid input syntax for type date")
            // and range (`2026-13-01` → "date/time field value out
            // of range"). Codex P2 (2026-05-28): the range variant
            // wasn't matched, so a bogus date 500'd the whole import.
            /invalid input syntax for type date|date\/time field value out of range/i.test(message) ||
            // Numeric overflow on `numeric(4,1)` (heightHands) or
            // `integer` columns. Codex P2 (2026-05-28 iter 2): if a
            // row has `heightHands=99.9` Zod accepts it but Postgres
            // raises "numeric field overflow"; without this
            // classification the whole import 500'd after partial
            // success.
            /numeric field overflow|value out of range for type|integer out of range/i.test(message);
          if (!isRowLevel) {
            logger.error('horse_bulk_import_infra_error', {
              clubId: ctx.clubId,
              index: i,
              csvRow,
              error: message,
            });
            throw err; // → 500 via the outer error handler
          }

          failureCount += 1;
          let friendly = 'Could not create — review the row and try again.';
          if (/duplicate key|unique constraint/i.test(message)) {
            friendly =
              'Duplicate value — check the microchip / passport / registration number columns.';
          } else if (/violates foreign key/i.test(message)) {
            friendly =
              'Referenced record (club / owner) is missing or inactive. Contact support.';
          } else if (
            /invalid input syntax for type date|date\/time field value out of range/i.test(message)
          ) {
            friendly = 'Invalid date — use YYYY-MM-DD and a real calendar date.';
          } else if (
            /numeric field overflow|value out of range for type|integer out of range/i.test(message)
          ) {
            friendly =
              'Numeric value out of range — check heightHands / weightKg / fee columns for realistic values.';
          }
          logger.warn('horse_bulk_import_row_failed', {
            clubId: ctx.clubId,
            index: i,
            csvRow,
            name: row.name,
            error: message,
          });
          results.push({
            success: false,
            index: i,
            csvRow,
            name: row.name,
            error: friendly,
          });
        }
      }

      logger.info('horse_bulk_import_complete', {
        clubId: ctx.clubId,
        total: data.horses.length,
        successCount,
        failureCount,
      });

      return successResponse(
        {
          successCount,
          failureCount,
          total: data.horses.length,
          results,
        },
        201,
      );
    },
    {
      requiredPermission: 'horses:update',
      // Per-user rate limit. failClosed so an Upstash blip doesn't
      // lift the cap on a row-insert surface that could otherwise be
      // abused to dump a few thousand junk rows quickly.
      rateLimit: { maxRequests: 5, windowMs: 60 * 60_000, failClosed: true },
      routeKey: 'horses:bulk',
    },
  );
}

