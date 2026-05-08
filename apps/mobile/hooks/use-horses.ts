import { useQuery } from '@tanstack/react-query';
import { type HorseListItem } from '@equestrian/shared/types';
import { horseListItemSchema } from '@equestrian/shared/schemas/responses';
import { useApiClient } from '@/lib/api';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): mobile previously declared a looser
// `Horse` shape with `status: string` / `skillLevel: string` here, drifting
// from web's precise enum unions. Both apps now narrow against
// `HorseListItem` from `packages/shared/src/types/responses/horses.ts`.
//
// The previous local export was named `Horse`; alias for backwards-compat
// with mobile screens importing `type Horse from '@/hooks/use-horses'`.
export type Horse = HorseListItem;

export function useHorses(filters: { status?: string; page?: number } = {}) {
  const api = useApiClient();
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  params.set('pageSize', '50');

  // Audit F-6 (2026-05-07 r5 PR Sigma): paginated route returns
  // `{success, data: HorseListItem[], pagination}`; using
  // `getPaginated<HorseListItem>` gives the discriminated
  // `PaginatedApiResponse<HorseListItem>` directly.
  // Audit F-69 companion (2026-05-08 r6 PR Xi-2): `validate:` runs each
  // item through `horseListItemSchema` so a server-side projection
  // drift (status enum literal renamed, column dropped) surfaces an
  // INVALID_RESPONSE the device-console / Sentry path captures with
  // the exact failing field, instead of a silent `undefined` deref in
  // the rider home screen.
  return useQuery({
    queryKey: ['horses', filters],
    queryFn: () =>
      api.getPaginated<HorseListItem>(`/api/v1/horses?${params.toString()}`, {
        schema: horseListItemSchema,
      }),
  });
}
