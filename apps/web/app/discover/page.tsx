import { Suspense } from 'react';
import { DiscoverClient } from './discover-client';

// Public rider-facing discovery. No auth needed — the whole point is to let
// people browse before committing to a sign-up.
export default function DiscoverPage() {
  return (
    <Suspense fallback={null}>
      <DiscoverClient />
    </Suspense>
  );
}
