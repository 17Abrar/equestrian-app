'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type CreateStaffInput, type UpdateStaffInput } from '@equestrian/shared/schemas';
import { type ApiSuccessResponse, type ApiResponse, type PaginatedResponse } from '@equestrian/shared/types';

export interface ClubMember {
  id: string;
  clerkUserId: string;
  role: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) {
    throw new Error((data as { error?: { message?: string } }).error?.message ?? 'Request failed');
  }
  return data as T;
}

// ─── Member Dropdowns ─────────────────────────────────────────────────

export function useOwnerMembers() {
  return useQuery({
    queryKey: ['members', 'horse_owner'],
    queryFn: () => fetchJson<ApiSuccessResponse<ClubMember[]>>('/api/v1/members?role=horse_owner'),
  });
}

export function useRiderMembers() {
  return useQuery({
    queryKey: ['members', 'rider'],
    queryFn: () => fetchJson<ApiSuccessResponse<ClubMember[]>>('/api/v1/members?role=rider'),
  });
}

export function useCoachMembers() {
  return useQuery({
    queryKey: ['members', 'coach'],
    queryFn: () => fetchJson<ApiSuccessResponse<ClubMember[]>>('/api/v1/members?role=coach'),
  });
}

// ─── Staff CRUD ───────────────────────────────────────────────────────

export function useStaff(filters: { search?: string; role?: string; page?: number; pageSize?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.role) params.set('role', filters.role);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['staff', filters],
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
      queryClient.invalidateQueries({ queryKey: ['staff'] });
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
      queryClient.invalidateQueries({ queryKey: ['staff'] });
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
      queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });
}

// ─── Owners CRUD ──────────────────────────────────────────────────────

export function useOwners(filters: { search?: string; page?: number; pageSize?: number } = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['owners', filters],
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
      queryClient.invalidateQueries({ queryKey: ['owners'] });
      queryClient.invalidateQueries({ queryKey: ['members', 'horse_owner'] });
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
      queryClient.invalidateQueries({ queryKey: ['owners'] });
      queryClient.invalidateQueries({ queryKey: ['members', 'horse_owner'] });
    },
  });
}
