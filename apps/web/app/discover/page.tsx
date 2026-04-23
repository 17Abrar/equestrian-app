import { Suspense } from 'react';
import { DiscoverClient } from './discover-client';

// Public rider-facing discovery. No auth needed — the whole point is to let
// people browse before committing to a sign-up.
//
// Edge-cached for 60s at Cloudflare so the landing hit is instant for most
// visitors; the Worker only does real work once per minute per edge PoP.
export const revalidate = 60;

export default function DiscoverPage() {
  return (
    <Suspense fallback={null}>
      <DiscoverClient />
    </Suspense>
  );
}
