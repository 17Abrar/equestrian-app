import { type NextRequest, NextResponse } from 'next/server';
import { getPublicClubBySlug } from '@equestrian/db/queries';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { slug } = await params;
  const club = await getPublicClubBySlug(slug);
  if (!club) {
    return NextResponse.json(
      { success: false, error: { code: 'NOT_FOUND', message: 'Club not found' } },
      { status: 404 },
    );
  }
  return NextResponse.json({ success: true, data: club });
}
