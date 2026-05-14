import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getPublicClubBySlug } from '@equestrian/db/queries';
import { ClubProfileClient } from './club-profile-client';

// Edge-cache public club profile for 60s — clubs rarely change their logo,
// description, or join policy more than once a minute, and the join button
// flow is client-side anyway.
export const revalidate = 60;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const club = await getPublicClubBySlug(slug);
  if (!club) return { title: 'Club not found' };
  return {
    title: `${club.name} — Cavaliq`,
    description: club.shortDescription ?? club.description ?? `Join ${club.name} on Cavaliq.`,
    openGraph: {
      title: club.name,
      description: club.shortDescription ?? club.description ?? undefined,
      images: club.coverPhotoUrl ? [club.coverPhotoUrl] : undefined,
    },
  };
}

export default async function ClubProfilePage({ params }: PageProps) {
  const { slug } = await params;
  const club = await getPublicClubBySlug(slug);
  if (!club) notFound();

  // `joinPolicy` comes from DB as a varchar. Only "open" is a valid public
  // join state — legacy "approval" rows and "invite_only" are both treated
  // as private.
  const joinPolicy: 'open' | 'invite_only' = club.joinPolicy === 'open' ? 'open' : 'invite_only';

  // Audit 2026-05-13 (P1): Suspense boundary required by Next 15 — the client
  // now reads `useSearchParams()` for the post-signup auto-join handshake.
  return (
    <Suspense fallback={null}>
      <ClubProfileClient club={{ ...club, joinPolicy }} />
    </Suspense>
  );
}
