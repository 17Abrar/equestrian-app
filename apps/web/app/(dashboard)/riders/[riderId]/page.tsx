import { RiderProfile } from '@/components/riders/rider-profile';

interface RiderPageProps {
  params: Promise<{ riderId: string }>;
}

export default async function RiderPage({ params }: RiderPageProps) {
  const { riderId } = await params;
  return <RiderProfile riderId={riderId} />;
}
