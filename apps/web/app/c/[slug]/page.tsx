import { notFound } from 'next/navigation';
import { getPublicClubBySlug } from '@equestrian/db/queries';
import { ClubProfileClient } from './club-profile-client';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const club = await getPublicClubBySlug(slug);
  if (!club) return { title: 'Club not found' };
  return {
    title: `${club.name} — Cavaliq`,
    description:
      club.shortDescription ?? club.description ?? `Join ${club.name} on Cavaliq.`,
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

  // `joinPolicy` comes from DB as a varchar. Narrow it to the union the
  // client component expects — anything else (shouldn't happen because of the
  // DB CHECK constraint) falls back to invite_only as the safe default.
  const joinPolicy =
    club.joinPolicy === 'open' || club.joinPolicy === 'approval'
      ? club.joinPolicy
      : 'invite_only';

  return <ClubProfileClient club={{ ...club, joinPolicy }} />;
}
