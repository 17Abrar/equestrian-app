import { type NextRequest } from 'next/server';
import { createDocumentSchema } from '@equestrian/shared/schemas';
import { getDocuments, createDocument } from '@equestrian/db/queries';
import { withAuth, successResponse, validateInput } from '@/lib/api-utils';

interface RouteParams {
  params: Promise<{ horseId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const category = request.nextUrl.searchParams.get('category') ?? undefined;
      const documents = await getDocuments(ctx.clubId, horseId, category);
      return successResponse(documents);
    },
    { requiredPermission: 'horses:read' },
  );
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  return withAuth(
    async (ctx) => {
      const { horseId } = await params;
      const body = await request.json();
      const data = validateInput(createDocumentSchema, body);

      const document = await createDocument(ctx.clubId, horseId, {
        ...data,
        uploadedByMemberId: ctx.memberId,
      });

      return successResponse(document, 201);
    },
    { requiredPermission: 'horses:update' },
  );
}
