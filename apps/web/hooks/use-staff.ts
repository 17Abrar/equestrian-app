'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type CreateStaffInput, type UpdateStaffInput } from '@equestrian/shared/schemas';
import {
  type ApiResponse,
  type PaginatedResponse,
  type ClubMember,
} from '@equestrian/shared/types';
import { MAX_PAGE_SIZE } from '@equestrian/shared/constants';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): `ClubMember` is now in
// `packages/shared/src/types/responses/staff.ts`, with `role` typed as the
// project `UserRole` enum union rather than `string`.
export type { ClubMember };

// Audit pass-10 F-9 (2026-05-14): apply the list-discriminator pattern (and
// pick out only URL-bound fields) so future detail hooks don't collide with
// the list key and so unknown keys on the filter literal can't inflate the
// query cache. The dropdown-by-role queries below stay as
// `['members', role]` — they have no filter object and have a different
// invalidation lifecycle than the paginated `/staff` + `/owners` lists.
interface NormalizedStaffFilters {
  search?: string;
  role?: string;
  page?: number;
  pageSize?: number;
}
const STAFF_KEY = ['staff'] as const;
const staffListKey = (filters: NormalizedStaffFilters) =>
  [...STAFF_KEY, 'list', filters] as const;

interface NormalizedOwnersFilters {
  search?: string;
  page?: number;
  pageSize?: number;
}
const OWNERS_KEY = ['owners'] as const;
const ownersListKey = (filters: NormalizedOwnersFilters) =>
  [...OWNERS_KEY, 'list', filters] as const;

// ─── Member Dropdowns ─────────────────────────────────────────────────
//
// Audit F-6 / F-7 (2026-05-07 r4): the routes return `paginatedResponse(...)`,
// not a flat array, and enforce the default 25-row page when no pageSize is
// passed. The previous `ApiSuccessResponse<T[]>` annotation lied — `data` is
// still the array (both envelopes use `data: T[]`), but the cap meant a club
// with 26+ members in the role silently truncated the dropdown. Pickers now
// pass `pageSize=MAX_PAGE_SIZE` (50) and declare the paginated envelope so
// future contributors can read `pagination.total` if they need a "+ N more"
// hint past 50.

export function useOwnerMembers() {
  return useQuery({
    queryKey: ['members', 'horse_owner'],
    queryFn: () =>
      fetchJson<PaginatedResponse<ClubMember>>(
        `/api/v1/members?role=horse_owner&pageSize=${MAX_PAGE_SIZE}`,
      ),
  });
}

export function useRiderMembers() {
  return useQuery({
    queryKey: ['members', 'rider'],
    queryFn: () =>
      fetchJson<PaginatedResponse<ClubMember>>(
        `/api/v1/members?role=rider&pageSize=${MAX_PAGE_SIZE}`,
      ),
  });
}

export function useCoachMembers() {
  return useQuery({
    queryKey: ['members', 'coach'],
    queryFn: () =>
      fetchJson<PaginatedResponse<ClubMember>>(
        `/api/v1/members?role=coach&pageSize=${MAX_PAGE_SIZE}`,
      ),
  });
}

// ─── Staff CRUD ───────────────────────────────────────────────────────

export function useStaff(filters: NormalizedStaffFilters = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.role) params.set('role', filters.role);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const normalized: NormalizedStaffFilters = {
    search: filters.search,
    role: filters.role,
    page: filters.page,
    pageSize: filters.pageSize,
  };

  return useQuery({
    queryKey: staffListKey(normalized),
    queryFn: () => fetchJson<PaginatedResponse<ClubMember>>(`/api/v1/staff?${params.toString()}`),
  });
}

export function useCreateStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateStaffInput) =>
      fetchJson<ApiResponse<ClubMember>>('/api/v1/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...STAFF_KEY, 'list'] });
    },
  });
}

export function useUpdateStaff(memberId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateStaffInput) =>
      fetchJson<ApiResponse<ClubMember>>(`/api/v1/staff/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...STAFF_KEY, 'list'] });
    },
  });
}

export function useDeactivateStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/staff/${memberId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...STAFF_KEY, 'list'] });
    },
  });
}

// ─── Owners CRUD ──────────────────────────────────────────────────────

export function useOwners(filters: NormalizedOwnersFilters = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const normalized: NormalizedOwnersFilters = {
    search: filters.search,
    page: filters.page,
    pageSize: filters.pageSize,
  };

  return useQuery({
    queryKey: ownersListKey(normalized),
    queryFn: () => fetchJson<PaginatedResponse<ClubMember>>(`/api/v1/owners?${params.toString()}`),
  });
}

export function useCreateOwner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { displayName: string; email: string; phone?: string }) =>
      fetchJson<ApiResponse<ClubMember>>('/api/v1/owners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...OWNERS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['members', 'horse_owner'] });
    },
  });
}

export function useDeactivateOwner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/owners/${memberId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...OWNERS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['members', 'horse_owner'] });
    },
  });
}
