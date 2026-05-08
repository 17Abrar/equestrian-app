import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { createDocumentSchema } from '@equestrian/shared/schemas';
import { getDocuments, createDocument, getHorseById } from '@equestrian/db/queries';
import { fileCategoryEnum } from '@equestrian/db/schema';
import { withAuth,
  successResponse,
  errorResponse,
  validateInput,
  parsePagination,
  paginatedListResponse, validateUuidParam } from '@/lib/api-utils';
import { hasPermission } from '@/lib/permissions';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

// Audit F-7 (2026-05-08 r6): bind the `?category=` filter to the
// `file_category` pgEnum's literal tuple so an unknown value surfaces
// as a 400 (Zod) instead of bubbling to Postgres as
// `invalid input value for enum file_category` (500). Single-source-
// of-truth: any future enum addition picks up automatically.
const documentsFiltersSchema = z
  .object({
    category: z.enum(fileCategoryEnum.enumValues).optional(),
  })
  .strict();

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      validateUuidParam('horseId', horseId);
      const rawCategory = request.nextUrl.searchParams.get('category');
      const filters = validateInput(
        documentsFiltersSchema,
        rawCategory == null ? {} : { category: rawCategory },
      );
      const { page, pageSize } = parsePagination(request);
      const { items, total } = await getDocuments(ctx.clubId, horseId, filters.category, {
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
