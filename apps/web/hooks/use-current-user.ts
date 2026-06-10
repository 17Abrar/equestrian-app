'use client';

import { useQuery } from '@tanstack/react-query';
import { type UserRole } from '@equestrian/shared/types';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { STALE_TIME_STABLE } from '@equestrian/shared/constants';
import { fetchJson } from '@/lib/fetch-json';

interface ActiveClub {
  id: string;
  name: string;
  slug: string;
}

interface Membership {
  memberId: string;
  clubId: string;
  clubName: string;
  clubSlug: string;
  role: UserRole;
}

interface CurrentUser {
  userId: string;
  memberId: string | null;
  // Audit FE (2026-06-07): null for an authenticated user who has not joined
  // any club yet. /api/v1/me returns a clubless payload (200) for that state
  // instead of a 400, so the "find a stable" UI renders without a console error.
  orgId: string | null;
  role: UserRole | null;
  activeClub: ActiveClub | null;
  memberships: Membership[];
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => fetchJson<ApiSuccessResponse<CurrentUser>>('/api/v1/me'),
    staleTime: STALE_TIME_STABLE,
  });
}
