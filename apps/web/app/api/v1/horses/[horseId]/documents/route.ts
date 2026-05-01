import { type NextRequest } from 'next/server';
import { createDocumentSchema, paginationSchema } from '@equestrian/shared/schemas';
import { getDocuments, createDocument, getHorseById } from '@equestrian/db/queries';
import {
  withAuth,
  successResponse,
  errorResponse,
  validateInput,
  paginatedResponse,
} from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const category = request.nextUrl.searchParams.get('category') ?? undefined;
      const { page, pageSize } = validateInput(paginationSchema, {
        page: request.nextUrl.searchParams.get('page') ?? undefined,
        pageSize: request.nextUrl.searchParams.get('pageSize') ?? undefined,
      });
      const { items, total } = await getDocuments(ctx.clubId, horseId, category, {
        page,
        pageSize,
      });
      return paginatedResponse(items, { page, pageSize, total });
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;

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
    },
    { requiredPermission: 'horses:update' },
  );
}
