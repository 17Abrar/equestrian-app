import { HorseProfile } from '@/components/horses/horse-profile';

interface HorsePageProps {
  params: Promise<{ horseId: string }>;
}

export default async function HorsePage({ params }: HorsePageProps) {
  const { horseId } = await params;
  return <HorseProfile horseId={horseId} />;
}
