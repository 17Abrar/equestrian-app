'use client';

import { useQuery } from '@tanstack/react-query';
import { type UserRole } from '@equestrian/shared/types';
import { type ApiSuccessResponse } from '@equestrian/shared/types';

interface CurrentUser {
  userId: string;
  memberId: string | null;
  orgId: string;
  role: UserRole;
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/v1/me');
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Failed to fetch user');
      }
      return data as ApiSuccessResponse<CurrentUser>;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes — user context rarely changes
  });
}
