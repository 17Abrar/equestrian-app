import { type NextRequest } from 'next/server';
import { createDocumentSchema } from '@equestrian/shared/schemas';
import { getDocuments, createDocument, getHorseById } from '@equestrian/db/queries';
import { withAuth,
  successResponse,
  errorResponse,
  validateInput,
  parsePagination,
  paginatedListResponse, validateUuidParam } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';
import {
  extractR2KeyFromUrl,
  requireVerifiedR2Object,
} from '@/lib/upload-verify-cache';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);
      const category = request.nextUrl.searchParams.get('category') ?? undefined;
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await getDocuments(ctx.clubId, horseId, category, {
        page,
        pageSize,
      });
      return paginatedListResponse(items, page, pageSize, total);
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(async (ctx) => {
    // Audit F-5 (2026-05-06): grooms (`horses:update_care`) and vets
    // (`horses:update_medical`) legitimately attach care/discharge
    // documents. The previous single-permission gate locked both
    // out of a workflow the role labels imply they own.
    const allowed =
      hasPermission(ctx.orgRole, 'horses:update') ||
      hasPermission(ctx.orgRole, 'horses:update_care') ||
      hasPermission(ctx.orgRole, 'horses:update_medical');
    if (!allowed) {
      return errorResponse(
        'FORBIDDEN',
        'You do not have permission to upload horse documents',
        403,
      );
    }

    const { horseId } = await params;
    validateUuidParam('horseId', horseId);

    // Bind the horse to this tenant before insert. The R2 file URL was already
    // verified against ctx.clubId by /api/v1/upload/verify, but the
    // horse_documents.horse_id FK references horses(id) only — without this
    // guard a forged URL referencing another club's horseId would attach the
    // file row to the wrong tenant.
    const horse = await getHorseById(ctx.clubId, horseId);
    if (!horse) {
      return errorResponse('NOT_FOUND', 'Horse not found', 404);
    }

    const body = await request.json();
    const data = validateInput(createDocumentSchema, body);

    // Audit F-8 (2026-05-08 r6): server-side verification gate. The
    // route comment used to claim "the R2 file URL was already verified
    // against ctx.clubId by /api/v1/upload/verify", but enforcement
    // sat in the web client only. A direct API caller skipping the
    // verify route would land the row without a magic-byte check.
    // `requireVerifiedR2Object` short-circuits on cached verification
    // (Redis hit) and falls through to inline verify on miss — the
    // typical happy path is no second R2 round-trip.
    if (data.fileType) {
      const r2Key = extractR2KeyFromUrl(data.fileUrl);
      if (!r2Key) {
        return errorResponse(
          'INVALID_FILE_URL',
          'fileUrl must be an R2 object URL produced by /api/v1/upload',
          400,
        );
      }
      const verified = await requireVerifiedR2Object(r2Key, data.fileType);
      if (!verified.ok) {
        return errorResponse(verified.code, verified.message, verified.status);
      }
    }

    const document = await createDocument(ctx.clubId, horseId, {
      ...data,
      uploadedByMemberId: ctx.memberId,
    });

    if (document) {
      void ctx.audit({
        action: 'horse_document.create',
        resourceType: 'horse_document',
        resourceId: document.id,
        changes: {
          horseId: { from: null, to: horseId },
        },
      });
    }

    return successResponse(document, 201);
  });
}
