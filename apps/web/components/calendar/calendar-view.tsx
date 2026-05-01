'use client';

import { useCalendarState } from '@/hooks/use-calendar-state';
import { useBookingSlots } from '@/hooks/use-bookings';
import { useCompetitionsCalendar } from '@/hooks/use-competitions';
import { CalendarToolbar } from './calendar-toolbar';
import { WeekView } from './week-view';
import { DayView } from './day-view';
import { MonthView } from './month-view';
import { AgendaView } from './agenda-view';
import { CalendarLegend } from './calendar-legend';
import { CreateRecurringSlotsDialog } from './create-recurring-slots-dialog';
import { CreateSingleSlotDialog } from './create-single-slot-dialog';
import { LessonTypesList } from '@/components/lesson-types/lesson-type-form';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/error-state';

function CalendarSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-10 w-64" />
      </div>
      <Skeleton className="h-[600px] w-full rounded-lg" />
    </div>
  );
}

export function CalendarView() {
  const calendar = useCalendarState({ defaultView: 'week' });

  const slotsQuery = useBookingSlots({
    dateFrom: calendar.dateRange.from,
    dateTo: calendar.dateRange.to,
  });

  const competitionsQuery = useCompetitionsCalendar(
    calendar.dateRange.from,
    calendar.dateRange.to,
  );

  const isLoading = slotsQuery.isLoading || competitionsQuery.isLoading;
  const isError = slotsQuery.isError || competitionsQuery.isError;
  const error = slotsQuery.error || competitionsQuery.error;

  if (isLoading) return <CalendarSkeleton />;
  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load calendar'}
        onRetry={() => {
          void slotsQuery.refetch();
          void competitionsQuery.refetch();
        }}
      />
    );
  }

  const slots = slotsQuery.data?.data ?? [];
  const competitions = competitionsQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
        <div className="flex items-center gap-2">
          <CreateSingleSlotDialog />
          <CreateRecurringSlotsDialog />
        </div>
      </div>

      <CalendarToolbar
        title={calendar.title}
        view={calendar.view}
        onViewChange={calendar.setView}
        onPrev={calendar.goToPrev}
        onNext={calendar.goToNext}
        onToday={calendar.goToToday}
      />

      {calendar.view === 'week' && (
        <WeekView
          weekDates={calendar.weekDates}
          slots={slots}
          competitions={competitions}
        />
      )}

      {calendar.view === 'day' && (
        <DayView
          date={calendar.currentDate}
          slots={slots}
          competitions={competitions}
        />
      )}

      {calendar.view === 'month' && (
        <MonthView
          currentDate={calendar.currentDate}
          slots={slots}
          competitions={competitions}
          onDayClick={(date) => {
            calendar.goToDate(date);
            calendar.setView('day');
          }}
        />
      )}

      {calendar.view === 'agenda' && (
        <AgendaView slots={slots} competitions={competitions} />
      )}

      <CalendarLegend slots={slots} competitions={competitions} />

      {/* Lesson Types Management */}
      <LessonTypesList />
    </div>
  );
}
