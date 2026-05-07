import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';

export interface Horse {
  id: string;
  clubId: string;
  name: string;
  barnName: string | null;
  breed: string | null;
  gender: string | null;
  color: string | null;
  status: string;
  skillLevel: string;
  temperament: string[] | null;
  weightLimitKg: string | null;
  minRiderAge: number | null;
  primaryPhotoUrl: string | null;
  photoUrls: string[] | null;
  createdAt: string;
}

export function useHorses(filters: { status?: string; page?: number } = {}) {
  const api = useApiClient();
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  params.set('pageSize', '50');

  // Audit F-6 (2026-05-07 r5 PR Sigma): paginated route returns
  // `{success, data: Horse[], pagination}`; using `getPaginated<Horse>`
  // gives us the discriminated `PaginatedApiResponse<Horse>` directly,
  // replacing the previous `as never as Promise<…>` double cast.
  return useQuery({
    queryKey: ['horses', filters],
    queryFn: () => api.getPaginated<Horse>(`/api/v1/horses?${params.toString()}`),
  });
}
