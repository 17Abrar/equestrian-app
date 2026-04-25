'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type CreateCompetitionInput,
  type UpdateCompetitionInput,
  type CreateCompetitionClassInput,
  type CreateCompetitionEntryInput,
  type CreateCompetitionResultInput,
  type CompetitionFiltersInput,
} from '@equestrian/shared/schemas';
import { type ApiSuccessResponse, type ApiResponse } from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

// ─── Types ────────────────────────────────────────────────────────────

export interface Competition {
  id: string;
  clubId: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  location: string | null;
  disciplines: string[] | null;
  entryFee: number | null;
  currency: string;
  registrationDeadline: string | null;
  maxParticipants: number | null;
  status: string;
  createdAt: string;
}

export interface CompetitionClass {
  id: string;
  clubId: string;
  competitionId: string;
  name: string;
  discipline: string | null;
  level: string | null;
  maxEntries: number | null;
  entryFee: number | null;
  currency: string;
  sortOrder: number;
}

export interface CompetitionEntry {
  id: string;
  classId: string;
  riderMemberId: string;
  horseId: string | null;
  status: string;
  paymentStatus: string;
  amount: number | null;
  currency: string;
  registeredAt: string;
  riderName: string | null;
  horseName: string | null;
}

export interface CompetitionResult {
  id: string;
  entryId: string;
  placing: number | null;
  timeSeconds: string | null;
  faults: number;
  notes: string | null;
  riderName: string | null;
  horseName: string | null;
}

export interface CalendarCompetition {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  location: string | null;
}

// ─── Competitions ─────────────────────────────────────────────────────

export function useCompetitions(filters: Partial<CompetitionFiltersInput> = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: ['competitions', filters],
    queryFn: () =>
      fetchJson<{ success: true; data: Competition[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(
        `/api/v1/competitions?${params.toString()}`,
      ),
  });
}

export function useCompetition(competitionId: string) {
  return useQuery({
    queryKey: ['competitions', competitionId],
    queryFn: () => fetchJson<ApiSuccessResponse<Competition>>(`/api/v1/competitions/${competitionId}`),
    enabled: !!competitionId,
  });
}

export function useCreateCompetition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCompetitionInput) =>
      fetchJson<ApiResponse<Competition>>('/api/v1/competitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitions'] });
    },
  });
}

export function useUpdateCompetition(competitionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateCompetitionInput) =>
      fetchJson<ApiResponse<Competition>>(`/api/v1/competitions/${competitionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitions'] });
      queryClient.invalidateQueries({ queryKey: ['competitions', competitionId] });
    },
  });
}

export function useDeleteCompetition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (competitionId: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/competitions/${competitionId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitions'] });
    },
  });
}

// ─── Competition Classes ──────────────────────────────────────────────

export function useCompetitionClasses(competitionId: string) {
  return useQuery({
    queryKey: ['competitions', competitionId, 'classes'],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<CompetitionClass[]>>(
        `/api/v1/competitions/${competitionId}/classes`,
      ),
    enabled: !!competitionId,
  });
}

export function useCreateCompetitionClass(competitionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCompetitionClassInput) =>
      fetchJson<ApiResponse<CompetitionClass>>(
        `/api/v1/competitions/${competitionId}/classes`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['competitions', competitionId, 'classes'] });
    },
  });
}

// ─── Competition Entries ──────────────────────────────────────────────

export function useCompetitionEntries(competitionId: string, classId: string) {
  return useQuery({
    queryKey: ['competitions', competitionId, 'classes', classId, 'entries'],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<CompetitionEntry[]>>(
        `/api/v1/competitions/${competitionId}/classes/${classId}/entries`,
      ),
    enabled: !!competitionId && !!classId,
  });
}

export function useCreateCompetitionEntry(competitionId: string, classId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCompetitionEntryInput) =>
      fetchJson<ApiResponse<CompetitionEntry>>(
        `/api/v1/competitions/${competitionId}/classes/${classId}/entries`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['competitions', competitionId, 'classes', classId, 'entries'],
      });
    },
  });
}

export function useWithdrawCompetitionEntry(competitionId: string, classId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entryId, reason }: { entryId: string; reason: string }) =>
      fetchJson<ApiResponse<CompetitionEntry>>(
        `/api/v1/competitions/${competitionId}/classes/${classId}/entries/${entryId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['competitions', competitionId, 'classes', classId, 'entries'],
      });
    },
  });
}

// ─── Competition Results ──────────────────────────────────────────────

export function useCompetitionResults(competitionId: string, classId: string) {
  return useQuery({
    queryKey: ['competitions', competitionId, 'classes', classId, 'results'],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<CompetitionResult[]>>(
        `/api/v1/competitions/${competitionId}/classes/${classId}/results`,
      ),
    enabled: !!competitionId && !!classId,
  });
}

export function useCreateCompetitionResult(competitionId: string, classId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCompetitionResultInput) =>
      fetchJson<ApiResponse<CompetitionResult>>(
        `/api/v1/competitions/${competitionId}/classes/${classId}/results`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['competitions', competitionId, 'classes', classId, 'results'],
      });
    },
  });
}

// ─── Calendar Integration ─────────────────────────────────────────────

export function useCompetitionsCalendar(dateFrom: string, dateTo: string) {
  return useQuery({
    queryKey: ['competitions', 'calendar', dateFrom, dateTo],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<CalendarCompetition[]>>(
        `/api/v1/competitions/calendar?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    enabled: !!dateFrom && !!dateTo,
  });
}
