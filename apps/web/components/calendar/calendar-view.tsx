'use client';

import { useState } from 'react';
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
import { EmptyState } from '@/components/shared/empty-state';
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
  // Audit F-66 (2026-05-07 r5): lift dialog open state so the
  // empty-state CTA (visible when no slots/competitions exist in the
  // current range, regardless of view) can drive the same dialogs the
  // header buttons trigger.
  const [singleSlotOpen, setSingleSlotOpen] = useState(false);
  const [recurringSlotsOpen, setRecurringSlotsOpen] = useState(false);

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
  const isEmpty = slots.length === 0 && competitions.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Calendar</h1>
        <div className="flex items-center gap-2">
          <CreateSingleSlotDialog
            open={singleSlotOpen}
            onOpenChange={setSingleSlotOpen}
          />
          <CreateRecurringSlotsDialog
            open={recurringSlotsOpen}
            onOpenChange={setRecurringSlotsOpen}
          />
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

      {/* Audit F-66 (2026-05-07 r5): cross-view EmptyState. Renders
          above the calendar grid whenever the current range has zero
          slots and zero competitions, regardless of view. The Day /
          Week / Month grids still render below so the user retains
          context — they just gain an obvious "Create your first slot"
          affordance instead of seeing only blank cells. */}
      {isEmpty && (
        <EmptyState
          title="Nothing scheduled in this range"
          description="Create your first slot to start scheduling lessons."
          action={{
            label: 'Add Single Slot',
            onClick: () => setSingleSlotOpen(true),
          }}
        />
      )}

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
