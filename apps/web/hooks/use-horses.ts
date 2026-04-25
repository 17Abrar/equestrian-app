'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type HorseFiltersInput, type CreateHorseInput, type UpdateHorseInput } from '@equestrian/shared/schemas';
import { type ApiResponse, type PaginatedResponse } from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

export interface Horse {
  id: string;
  name: string;
  barnName: string | null;
  breed: string | null;
  gender: string | null;
  color: string | null;
  dateOfBirth: string | null;
  heightHands: string | null;
  weightKg: string | null;
  markings: string | null;
  microchipNumber: string | null;
  passportNumber: string | null;
  registrationNumber: string | null;
  status: string;
  skillLevel: string;
  temperament: string[] | null;
  weightLimitKg: string | null;
  minRiderAge: number | null;
  maxLessonsPerDay: number;
  mandatoryRestDays: number;
  saleStatus: string;
  purchasePrice: number | null;
  currentValue: number | null;
  salePrice: number | null;
  saddleSize: string | null;
  girthSize: string | null;
  bridleSize: string | null;
  bitType: string | null;
  bitSize: string | null;
  blanketSize: string | null;
  bootsSize: string | null;
  gearNotes: string | null;
  insuranceProvider: string | null;
  insurancePolicyNumber: string | null;
  insuranceCoverage: string | null;
  insuranceExpiry: string | null;
  primaryPhotoUrl: string | null;
  photoUrls: string[] | null;
  ownerMemberId: string | null;
  notes: string | null;
  ownershipStatus: 'pending' | 'active' | 'retired' | 'declined';
  monthlyLiveryFeeMinor: number | null;
  liveryStartDate: string | null;
  liveryEndDate: string | null;
  ownershipDeclineReason: string | null;
  ownershipSubmittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerName: string | null;
  ownerEmail?: string | null;
  ownerClerkUserId?: string | null;
  clubCurrency?: string;
}

export function useHorses(filters: Partial<HorseFiltersInput> = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.status) params.set('status', filters.status);
  if (filters.skillLevel) params.set('skillLevel', filters.skillLevel);
  if (filters.ownershipStatus) params.set('ownershipStatus', filters.ownershipStatus);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['horses', filters],
    queryFn: () => fetchJson<PaginatedResponse<Horse>>(`/api/v1/horses?${params.toString()}`),
    // 30s is enough to dedupe back-to-back fetches (tab switches, nav badges)
    // while still feeling live. Mutations explicitly invalidate so approvals
    // reflect immediately without waiting on this window.
    staleTime: 30_000,
  });
}

interface ApproveInput {
  monthlyLiveryFeeMinor: number;
  liveryStartDate: string;
}

export function useApproveHorseOwnership(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ApproveInput) =>
      fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}/approve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['horses'] });
    },
  });
}

export function useDeclineHorseOwnership(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}/decline`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['horses'] });
    },
  });
}

export function useRetireHorseOwnership(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (liveryEndDate?: string) =>
      fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}/retire`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liveryEndDate }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['horses'] });
      queryClient.invalidateQueries({ queryKey: ['horses', horseId] });
    },
  });
}

export function useHorse(horseId: string) {
  return useQuery({
    queryKey: ['horses', horseId],
    queryFn: () => fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}`),
    enabled: !!horseId,
  });
}

export function useCreateHorse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateHorseInput) =>
      fetchJson<ApiResponse<Horse>>('/api/v1/horses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['horses'] });
    },
  });
}

export function useUpdateHorse(horseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateHorseInput) =>
      fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['horses'] });
      queryClient.invalidateQueries({ queryKey: ['horses', horseId] });
    },
  });
}

export function useTransferHorseOwner(horseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ownerMemberId: string | null) =>
      fetchJson<ApiResponse<Horse>>(`/api/v1/horses/${horseId}/owner`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerMemberId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['horses'] });
      queryClient.invalidateQueries({ queryKey: ['horses', horseId] });
    },
  });
}

export function useDeleteHorse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (horseId: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/horses/${horseId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['horses'] });
    },
  });
}
