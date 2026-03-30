import { CompetitionDetail } from '@/components/competitions/competition-detail';

export default async function CompetitionDetailPage({
  params,
}: {
  params: Promise<{ competitionId: string }>;
}) {
  const { competitionId } = await params;
  return <CompetitionDetail competitionId={competitionId} />;
}
