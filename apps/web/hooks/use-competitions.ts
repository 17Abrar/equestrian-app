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
import {
  type ApiSuccessResponse,
  type ApiResponse,
  type Competition,
  type CompetitionClass,
  type CompetitionEntry,
  type CompetitionResult,
  type CalendarCompetition,
} from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): competition DTOs consolidated under
// `packages/shared/src/types/responses/competitions.ts` — `status` /
// `paymentStatus` etc. are now the project-wide enums rather than `string`.
export type {
  Competition,
  CompetitionClass,
  CompetitionEntry,
  CompetitionResult,
  CalendarCompetition,
};

// Audit 2026-05-13 (P1): list/detail key split — see use-bookings.ts header.
// Previously `['competitions', filters]` (list) and `['competitions', id]`
// (detail) collided so list mutations refetched every mounted detail.
const COMPETITIONS_KEY = ['competitions'] as const;
const competitionsListKey = (filters: Partial<CompetitionFiltersInput>) =>
  [...COMPETITIONS_KEY, 'list', filters] as const;
const competitionDetailKey = (competitionId: string) =>
  [...COMPETITIONS_KEY, 'detail', competitionId] as const;
const competitionClassesKey = (competitionId: string) =>
  [...COMPETITIONS_KEY, 'detail', competitionId, 'classes'] as const;
const competitionEntriesKey = (competitionId: string, classId: string) =>
  [...COMPETITIONS_KEY, 'detail', competitionId, 'classes', classId, 'entries'] as const;
const competitionResultsKey = (competitionId: string, classId: string) =>
  [...COMPETITIONS_KEY, 'detail', competitionId, 'classes', classId, 'results'] as const;

// ─── Competitions ─────────────────────────────────────────────────────

export function useCompetitions(filters: Partial<CompetitionFiltersInput> = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  return useQuery({
    queryKey: competitionsListKey(filters),
    queryFn: () =>
      fetchJson<{
        success: true;
        data: Competition[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      }>(`/api/v1/competitions?${params.toString()}`),
  });
}

export function useCompetition(competitionId: string) {
  return useQuery({
    queryKey: competitionDetailKey(competitionId),
    queryFn: () =>
      fetchJson<ApiSuccessResponse<Competition>>(`/api/v1/competitions/${competitionId}`),
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
      void queryClient.invalidateQueries({ queryKey: [...COMPETITIONS_KEY, 'list'] });
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
      void queryClient.invalidateQueries({ queryKey: [...COMPETITIONS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: competitionDetailKey(competitionId) });
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
    onSuccess: (_data, competitionId) => {
      void queryClient.invalidateQueries({ queryKey: [...COMPETITIONS_KEY, 'list'] });
      void queryClient.invalidateQueries({ queryKey: competitionDetailKey(competitionId) });
    },
  });
}

// ─── Competition Classes ──────────────────────────────────────────────

// Audit r5 F-58 (2026-05-07): the classes route now returns the standard
// paginated envelope `{ data, pagination }`. The hook keeps its existing
// shape (`data.data` is still an array of CompetitionClass) so the
// consumer in `competition-detail.tsx` doesn't need to change. `pageSize`
// caps at the server-side hard cap (200) so the existing UI which never
// paginated continues to render the full list under realistic loads.
export function useCompetitionClasses(competitionId: string) {
  return useQuery({
    queryKey: competitionClassesKey(competitionId),
    queryFn: () =>
      fetchJson<{
        success: true;
        data: CompetitionClass[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      }>(`/api/v1/competitions/${competitionId}/classes?pageSize=50`),
    enabled: !!competitionId,
  });
}

export function useCreateCompetitionClass(competitionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCompetitionClassInput) =>
      fetchJson<ApiResponse<CompetitionClass>>(`/api/v1/competitions/${competitionId}/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: competitionClassesKey(competitionId) });
    },
  });
}

// ─── Competition Entries ──────────────────────────────────────────────

export function useCompetitionEntries(competitionId: string, classId: string) {
  return useQuery({
    queryKey: competitionEntriesKey(competitionId, classId),
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
      void queryClient.invalidateQueries({
        queryKey: competitionEntriesKey(competitionId, classId),
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
      void queryClient.invalidateQueries({
        queryKey: competitionEntriesKey(competitionId, classId),
      });
    },
  });
}

// ─── Competition Results ──────────────────────────────────────────────

export function useCompetitionResults(competitionId: string, classId: string) {
  return useQuery({
    queryKey: competitionResultsKey(competitionId, classId),
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
      void queryClient.invalidateQueries({
        queryKey: competitionResultsKey(competitionId, classId),
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
