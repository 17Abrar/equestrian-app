'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type CreateHealthRecordInput,
  type CreateMedicationInput,
  type CreateMedicationLogInput,
  type CreateFeedingPlanInput,
  type CreateExerciseScheduleInput,
  type CreateDocumentInput,
} from '@equestrian/shared/schemas';
import {
  type ApiSuccessResponse,
  type ApiResponse,
  type HealthRecord,
  type Medication,
  type MedicationLog,
  type FeedingPlan,
  type ExerciseSchedule,
  type HorseDocument,
} from '@equestrian/shared/types';
import { fetchJson } from '@/lib/fetch-json';

// Audit F-4 (2026-05-08 r6 PR Alpha-2): horse-health list DTOs are
// consolidated under `packages/shared/src/types/responses/horse-health.ts`.
// They're list-row shapes — the query layer narrows out encrypted PHI
// (`description`/`diagnosis`/`treatment`/`notes`) before serializing.
// Re-exported below so existing consumers keep working.
export type {
  HealthRecord,
  Medication,
  MedicationLog,
  FeedingPlan,
  ExerciseSchedule,
  HorseDocument,
};

// ─── Health Records ───────────────────────────────────────────────────

export function useHealthRecords(horseId: string, recordType?: string) {
  const params = recordType ? `?recordType=${recordType}` : '';
  return useQuery({
    queryKey: ['horses', horseId, 'health', recordType],
    queryFn: () => fetchJson<ApiSuccessResponse<HealthRecord[]>>(`/api/v1/horses/${horseId}/health${params}`),
    enabled: !!horseId,
  });
}

export function useCreateHealthRecord(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateHealthRecordInput) =>
      fetchJson<ApiResponse<HealthRecord>>(`/api/v1/horses/${horseId}/health`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId, 'health'] });
    },
  });
}

export function useDeleteHealthRecord(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recordId: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/horses/${horseId}/health/${recordId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId, 'health'] });
    },
  });
}

// ─── Medications ──────────────────────────────────────────────────────

export function useMedications(horseId: string, activeOnly = false) {
  const params = activeOnly ? '?activeOnly=true' : '';
  return useQuery({
    queryKey: ['horses', horseId, 'medications', activeOnly],
    queryFn: () => fetchJson<ApiSuccessResponse<Medication[]>>(`/api/v1/horses/${horseId}/medications${params}`),
    enabled: !!horseId,
  });
}

export function useCreateMedication(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMedicationInput) =>
      fetchJson<ApiResponse<Medication>>(`/api/v1/horses/${horseId}/medications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId, 'medications'] });
    },
  });
}

export function useUpdateMedication(horseId: string, medicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<CreateMedicationInput>) =>
      fetchJson<ApiResponse<Medication>>(`/api/v1/horses/${horseId}/medications/${medicationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId, 'medications'] });
    },
  });
}

// ─── Medication Logs ──────────────────────────────────────────────────

export function useMedicationLogs(horseId: string, medicationId: string) {
  return useQuery({
    queryKey: ['horses', horseId, 'medications', medicationId, 'logs'],
    queryFn: () => fetchJson<ApiSuccessResponse<MedicationLog[]>>(`/api/v1/horses/${horseId}/medications/${medicationId}/logs`),
    enabled: !!horseId && !!medicationId,
  });
}

export function useCreateMedicationLog(horseId: string, medicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateMedicationLogInput) =>
      fetchJson<ApiResponse<MedicationLog>>(`/api/v1/horses/${horseId}/medications/${medicationId}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId, 'medications', medicationId, 'logs'] });
    },
  });
}

// ─── Feeding Plans ────────────────────────────────────────────────────

export function useFeedingPlans(horseId: string) {
  return useQuery({
    queryKey: ['horses', horseId, 'feeding'],
    queryFn: () => fetchJson<ApiSuccessResponse<FeedingPlan[]>>(`/api/v1/horses/${horseId}/feeding`),
    enabled: !!horseId,
  });
}

export function useCreateFeedingPlan(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateFeedingPlanInput) =>
      fetchJson<ApiResponse<FeedingPlan>>(`/api/v1/horses/${horseId}/feeding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId, 'feeding'] });
    },
  });
}

export function useDeleteFeedingPlan(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (planId: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/horses/${horseId}/feeding/${planId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId, 'feeding'] });
    },
  });
}

// ─── Exercise Schedules ───────────────────────────────────────────────

export function useExerciseSchedules(horseId: string) {
  return useQuery({
    queryKey: ['horses', horseId, 'exercise'],
    queryFn: () => fetchJson<ApiSuccessResponse<ExerciseSchedule[]>>(`/api/v1/horses/${horseId}/exercise`),
    enabled: !!horseId,
  });
}

export function useCreateExerciseSchedule(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateExerciseScheduleInput) =>
      fetchJson<ApiResponse<ExerciseSchedule>>(`/api/v1/horses/${horseId}/exercise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId, 'exercise'] });
    },
  });
}

export function useDeleteExerciseSchedule(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scheduleId: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/horses/${horseId}/exercise/${scheduleId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId, 'exercise'] });
    },
  });
}

// ─── Documents ────────────────────────────────────────────────────────

export function useDocuments(horseId: string, category?: string) {
  const params = category ? `?category=${category}` : '';
  return useQuery({
    queryKey: ['horses', horseId, 'documents', category],
    queryFn: () => fetchJson<ApiSuccessResponse<HorseDocument[]>>(`/api/v1/horses/${horseId}/documents${params}`),
    enabled: !!horseId,
  });
}

export function useCreateDocument(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateDocumentInput) =>
      fetchJson<ApiResponse<HorseDocument>>(`/api/v1/horses/${horseId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId, 'documents'] });
    },
  });
}

export function useDeleteDocument(horseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) =>
      fetchJson<ApiResponse<{ id: string }>>(`/api/v1/horses/${horseId}/documents/${documentId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['horses', horseId, 'documents'] });
    },
  });
}
