import { Suspense } from 'react';
import { RiderBookingDetailClient, BookingSkeleton } from './booking-detail-client';

/**
 * Audit 2026-05-13 (P1): page is now a server-component shell that awaits
 * `params` (Next 15 promise shape) and wraps the client subtree in a Suspense
 * boundary. The Suspense is required because `RiderBookingDetailClient` reads
 * `useSearchParams()` to surface post-payment state — without an ancestor
 * Suspense, Next 15 logs a build-time warning and opts the whole subtree
 * out of static rendering.
 */
export default async function RiderBookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  return (
    <Suspense fallback={<BookingSkeleton />}>
      <RiderBookingDetailClient bookingId={bookingId} />
    </Suspense>
  );
}
