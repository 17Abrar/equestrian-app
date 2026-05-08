import { useQuery } from '@tanstack/react-query';
import {
  horseListItemSchema,
  type HorseListItemFromSchema,
} from '@equestrian/shared/schemas/responses';
import { useApiClient } from '@/lib/api';

// Audit F-69 companion (2026-05-08 r6): the local `Horse` type is
// derived from the runtime schema in @equestrian/shared so the two
// shapes can never drift. The mobile UI consumes the union of fields
// the schema gates on; new server-side projection columns flow via
// the schema's `.passthrough()` and don't break this hook.
export type Horse = HorseListItemFromSchema;

export function useHorses(filters: { status?: string; page?: number } = {}) {
  const api = useApiClient();
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  params.set('pageSize', '50');

  // Audit F-6 (2026-05-07 r5 PR Sigma): paginated route returns
  // `{success, data: Horse[], pagination}`; using `getPaginated<Horse>`
  // gives us the discriminated `PaginatedApiResponse<Horse>` directly.
  // Audit F-69 companion (2026-05-08 r6): `validate:` runs each item
  // through `horseListItemSchema` so a server-side projection drift
  // (e.g. status enum literal renamed, column dropped) surfaces an
  // INVALID_RESPONSE the device-console / Sentry path captures with
  // the exact failing field, instead of a silent `undefined` deref in
  // the rider home screen.
  return useQuery({
    queryKey: ['horses', filters],
    queryFn: () =>
      api.getPaginated<Horse>(`/api/v1/horses?${params.toString()}`, {
        validate: horseListItemSchema,
      }),
  });
}
