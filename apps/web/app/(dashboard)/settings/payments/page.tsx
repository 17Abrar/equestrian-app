import { Suspense } from 'react';
import { PaymentsSettingsPage } from '@/components/payments/payments-settings-page';

/**
 * Audit 2026-05-13 (P1): `PaymentsSettingsPage` reads `useSearchParams()` to
 * surface the OAuth-callback toast (see components/payments/payments-settings-page.tsx).
 * Next 15 requires a Suspense boundary around any client component that calls
 * `useSearchParams` — without one the whole subtree opts out of static
 * rendering and `next build` warns. The discovery page already follows this
 * pattern.
 */
export default function PaymentsSettingsRoute() {
  return (
    <Suspense fallback={null}>
      <PaymentsSettingsPage />
    </Suspense>
  );
}
