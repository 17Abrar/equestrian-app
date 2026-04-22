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

interface HorsesResponse {
  data: Horse[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export function useHorses(filters: { status?: string; page?: number } = {}) {
  const api = useApiClient();
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  params.set('pageSize', '50');

  return useQuery({
    queryKey: ['horses', filters],
    queryFn: () => api.get<Horse[]>(`/api/v1/horses?${params.toString()}` as never) as Promise<
      | { success: true; data: HorsesResponse['data']; pagination: HorsesResponse['pagination'] }
      | { success: false; error: { code: string; message: string } }
    >,
  });
}
