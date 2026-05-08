/**
 * Audit F-4 (2026-05-08 r6 PR Alpha-2): typed endpoint façade over the raw
 * `request<T>` / `requestPaginated<T>` primitives. Wires the route paths to
 * the consolidated DTOs in `@equestrian/shared/types/responses` so callers
 * narrow against the same shape web hooks use.
 *
 * This is the foundation, not the full surface — only the routes called out
 * in the audit (horses, bookings + lesson types + arenas, riders,
 * competitions, settings, finances, horse-health subresources) are wired up
 * here. Mutation paths and the long tail of nested routes (e.g.
 * competition-class entries, admin-only routes) can be added incrementally
 * without breaking existing consumers — web continues to use `fetchJson`
 * directly, mobile continues to use the raw `api.get` / `api.post`. Both
 * patterns live alongside this façade.
 */

import type {
  ApiResponse,
  PaginatedApiResponse,
  Horse,
  HorseListItem,
  Booking,
  BookingSlot,
  Arena,
  LessonType,
  Rider,
  Competition,
  CompetitionClass,
  CompetitionEntry,
  CompetitionResult,
  CalendarCompetition,
  ClubSettings,
  ClubMember,
  Coupon,
  Invoice,
  Payment,
  Expense,
  FinanceOverview,
  HealthRecord,
  Medication,
  MedicationLog,
  FeedingPlan,
  ExerciseSchedule,
  HorseDocument,
} from '@equestrian/shared/types';
import type { ApiClient } from '../client';

interface ListFilters {
  page?: number;
  pageSize?: number;
}

interface HorseListFilters extends ListFilters {
  search?: string;
  status?: string;
  skillLevel?: string;
  ownershipStatus?: string;
}

interface BookingListFilters extends ListFilters {
  status?: string;
  date?: string;
  lessonTypeId?: string;
  riderMemberId?: string;
}

interface BookingSlotFilters {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  lessonTypeId?: string;
  coachMemberId?: string;
}

interface CompetitionFilters extends ListFilters {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
}

interface RiderListFilters extends ListFilters {
  search?: string;
  skillLevel?: string;
}

interface FinanceListFilters extends ListFilters {
  status?: string;
}

function toQuery<F extends object>(filters: F | undefined): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Wraps a raw `ApiClient` with strongly-typed endpoint methods. Web hooks
 * keep using `fetchJson` directly (browser-side fetch with cookie auth);
 * mobile callers and any future SDK consumer can use this façade for the
 * narrowed return type.
 */
export function createEndpoints(api: ApiClient) {
  return {
    horses: {
      list: (
        filters?: HorseListFilters,
      ): Promise<PaginatedApiResponse<HorseListItem>> =>
        api.getPaginated<HorseListItem>(`/api/v1/horses${toQuery(filters)}`),
      get: (horseId: string): Promise<ApiResponse<Horse>> =>
        api.get<Horse>(`/api/v1/horses/${horseId}`),
    },
    bookings: {
      list: (
        filters?: BookingListFilters,
      ): Promise<PaginatedApiResponse<Booking>> =>
        api.getPaginated<Booking>(`/api/v1/bookings${toQuery(filters)}`),
      get: (bookingId: string): Promise<ApiResponse<Booking>> =>
        api.get<Booking>(`/api/v1/bookings/${bookingId}`),
    },
    bookingSlots: {
      // Non-paginated route (90-day window cap) — see use-bookings.ts.
      list: (
        filters?: BookingSlotFilters,
      ): Promise<ApiResponse<BookingSlot[]>> =>
        api.get<BookingSlot[]>(`/api/v1/booking-slots${toQuery(filters)}`),
    },
    arenas: {
      list: (
        filters?: ListFilters,
      ): Promise<PaginatedApiResponse<Arena>> =>
        api.getPaginated<Arena>(`/api/v1/arenas${toQuery(filters)}`),
    },
    lessonTypes: {
      list: (
        filters?: ListFilters,
      ): Promise<PaginatedApiResponse<LessonType>> =>
        api.getPaginated<LessonType>(`/api/v1/lesson-types${toQuery(filters)}`),
    },
    riders: {
      list: (
        filters?: RiderListFilters,
      ): Promise<PaginatedApiResponse<Rider>> =>
        api.getPaginated<Rider>(`/api/v1/riders${toQuery(filters)}`),
      get: (riderId: string): Promise<ApiResponse<Rider>> =>
        api.get<Rider>(`/api/v1/riders/${riderId}`),
    },
    members: {
      list: (
        filters?: ListFilters & { role?: string },
      ): Promise<PaginatedApiResponse<ClubMember>> =>
        api.getPaginated<ClubMember>(`/api/v1/members${toQuery(filters)}`),
    },
    competitions: {
      list: (
        filters?: CompetitionFilters,
      ): Promise<PaginatedApiResponse<Competition>> =>
        api.getPaginated<Competition>(`/api/v1/competitions${toQuery(filters)}`),
      get: (competitionId: string): Promise<ApiResponse<Competition>> =>
        api.get<Competition>(`/api/v1/competitions/${competitionId}`),
      classes: {
        list: (competitionId: string): Promise<PaginatedApiResponse<CompetitionClass>> =>
          api.getPaginated<CompetitionClass>(
            `/api/v1/competitions/${competitionId}/classes?pageSize=50`,
          ),
        entries: (
          competitionId: string,
          classId: string,
        ): Promise<ApiResponse<CompetitionEntry[]>> =>
          api.get<CompetitionEntry[]>(
            `/api/v1/competitions/${competitionId}/classes/${classId}/entries`,
          ),
        results: (
          competitionId: string,
          classId: string,
        ): Promise<ApiResponse<CompetitionResult[]>> =>
          api.get<CompetitionResult[]>(
            `/api/v1/competitions/${competitionId}/classes/${classId}/results`,
          ),
      },
      calendar: (
        dateFrom: string,
        dateTo: string,
      ): Promise<ApiResponse<CalendarCompetition[]>> =>
        api.get<CalendarCompetition[]>(
          `/api/v1/competitions/calendar?dateFrom=${dateFrom}&dateTo=${dateTo}`,
        ),
    },
    settings: {
      get: (): Promise<ApiResponse<ClubSettings>> =>
        api.get<ClubSettings>('/api/v1/settings'),
    },
    finances: {
      overview: (): Promise<ApiResponse<FinanceOverview>> =>
        api.get<FinanceOverview>('/api/v1/finances/overview'),
      coupons: {
        list: (
          filters?: FinanceListFilters,
        ): Promise<PaginatedApiResponse<Coupon>> =>
          api.getPaginated<Coupon>(`/api/v1/finances/coupons${toQuery(filters)}`),
      },
      invoices: {
        list: (
          filters?: FinanceListFilters,
        ): Promise<PaginatedApiResponse<Invoice>> =>
          api.getPaginated<Invoice>(`/api/v1/finances/invoices${toQuery(filters)}`),
      },
      payments: {
        list: (
          filters?: FinanceListFilters,
        ): Promise<PaginatedApiResponse<Payment>> =>
          api.getPaginated<Payment>(`/api/v1/finances/payments${toQuery(filters)}`),
      },
      expenses: {
        list: (
          filters?: FinanceListFilters & { category?: string; dateFrom?: string; dateTo?: string },
        ): Promise<PaginatedApiResponse<Expense>> =>
          api.getPaginated<Expense>(`/api/v1/finances/expenses${toQuery(filters)}`),
      },
    },
    horseHealth: {
      records: {
        list: (
          horseId: string,
          recordType?: string,
        ): Promise<ApiResponse<HealthRecord[]>> =>
          api.get<HealthRecord[]>(
            `/api/v1/horses/${horseId}/health${recordType ? `?recordType=${recordType}` : ''}`,
          ),
      },
      medications: {
        list: (
          horseId: string,
          activeOnly?: boolean,
        ): Promise<ApiResponse<Medication[]>> =>
          api.get<Medication[]>(
            `/api/v1/horses/${horseId}/medications${activeOnly ? '?activeOnly=true' : ''}`,
          ),
        logs: (
          horseId: string,
          medicationId: string,
        ): Promise<ApiResponse<MedicationLog[]>> =>
          api.get<MedicationLog[]>(
            `/api/v1/horses/${horseId}/medications/${medicationId}/logs`,
          ),
      },
      feeding: {
        list: (horseId: string): Promise<ApiResponse<FeedingPlan[]>> =>
          api.get<FeedingPlan[]>(`/api/v1/horses/${horseId}/feeding`),
      },
      exercise: {
        list: (horseId: string): Promise<ApiResponse<ExerciseSchedule[]>> =>
          api.get<ExerciseSchedule[]>(`/api/v1/horses/${horseId}/exercise`),
      },
      documents: {
        list: (
          horseId: string,
          category?: string,
        ): Promise<ApiResponse<HorseDocument[]>> =>
          api.get<HorseDocument[]>(
            `/api/v1/horses/${horseId}/documents${category ? `?category=${category}` : ''}`,
          ),
      },
    },
  } as const;
}

export type Endpoints = ReturnType<typeof createEndpoints>;
