'use client';

import { MedicationsSection } from './health-tab';

/**
 * Audit P1 (2026-05-26): the audit flagged Medications as an under-
 * promoted product-plan deliverable — it lived as a section inside
 * the Health tab, so a vet/admin landing on a horse profile had to
 * click Health and scroll to find it. Promoting to a top-level tab
 * matches the DATABASE.md / product-plan.md terminology and the
 * frequency vets/grooms hit this surface.
 *
 * The actual MedicationsSection (with its add dialog, log buttons,
 * and active/all toggle) still lives in `health-tab.tsx` so a
 * Medications regression surfaces in one place. This wrapper exists
 * so `horse-profile.tsx` only imports a single component per tab.
 */
export function MedicationsTab({ horseId }: { horseId: string }) {
  return (
    <div className="space-y-6">
      <MedicationsSection horseId={horseId} />
    </div>
  );
}
