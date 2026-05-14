'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  format,
  addDays,
  addWeeks,
  addMonths,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  startOfDay,
  endOfDay,
} from 'date-fns';
import { WEEK_STARTS_ON } from '@/lib/ui-constants';

export type CalendarView = 'day' | 'week' | 'month' | 'agenda';

interface UseCalendarStateOptions {
  defaultView?: CalendarView;
  agendaLookaheadDays?: number;
}

export function useCalendarState(options: UseCalendarStateOptions = {}) {
  const { defaultView = 'week', agendaLookaheadDays = 30 } = options;

  const [view, setView] = useState<CalendarView>(defaultView);
  const [currentDate, setCurrentDate] = useState(new Date());

  const dateRange = useMemo(() => {
    switch (view) {
      case 'day':
        return {
          from: format(startOfDay(currentDate), 'yyyy-MM-dd'),
          to: format(endOfDay(currentDate), 'yyyy-MM-dd'),
        };
      case 'week': {
        const weekStart = startOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON });
        const weekEnd = addDays(weekStart, 6);
        return {
          from: format(weekStart, 'yyyy-MM-dd'),
          to: format(weekEnd, 'yyyy-MM-dd'),
        };
      }
      case 'month': {
        // Fetch a full 6-week grid (to cover partial weeks at start/end)
        const monthStart = startOfMonth(currentDate);
        const gridStart = startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON });
        const monthEnd = endOfMonth(currentDate);
        const gridEnd = addDays(startOfWeek(monthEnd, { weekStartsOn: WEEK_STARTS_ON }), 6);
        return {
          from: format(gridStart, 'yyyy-MM-dd'),
          to: format(gridEnd, 'yyyy-MM-dd'),
        };
      }
      case 'agenda': {
        const today = startOfDay(new Date());
        return {
          from: format(today, 'yyyy-MM-dd'),
          to: format(addDays(today, agendaLookaheadDays), 'yyyy-MM-dd'),
        };
      }
      default: {
        // Audit 2026-05-13 (P2): exhaustiveness check. If a future
        // contributor extends `CalendarView` (e.g. 'timeline', 'year')
        // and forgets to add a `case`, the switch would silently fall
        // through, dateRange would become `undefined`, and every
        // consuming `useQuery` would key on undefined and refetch the
        // same URL repeatedly. The `never` assignment turns that into
        // a TS error at the new-case site.
        const _exhaustive: never = view;
        throw new Error(`Unhandled calendar view: ${String(_exhaustive)}`);
      }
    }
  }, [view, currentDate, agendaLookaheadDays]);

  const weekDates = useMemo(() => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON });
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [currentDate]);

  const goToNext = useCallback(() => {
    setCurrentDate((d) => {
      switch (view) {
        case 'day':
          return addDays(d, 1);
        case 'week':
          return addWeeks(d, 1);
        case 'month':
          return addMonths(d, 1);
        case 'agenda':
          return addDays(d, agendaLookaheadDays);
      }
    });
  }, [view, agendaLookaheadDays]);

  const goToPrev = useCallback(() => {
    setCurrentDate((d) => {
      switch (view) {
        case 'day':
          return addDays(d, -1);
        case 'week':
          return addWeeks(d, -1);
        case 'month':
          return addMonths(d, -1);
        case 'agenda':
          return addDays(d, -agendaLookaheadDays);
      }
    });
  }, [view, agendaLookaheadDays]);

  const goToToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  const goToDate = useCallback((date: Date) => {
    setCurrentDate(date);
  }, []);

  const title = useMemo(() => {
    switch (view) {
      case 'day':
        return format(currentDate, 'EEEE, MMM d, yyyy');
      case 'week': {
        const weekStart = startOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON });
        const weekEnd = addDays(weekStart, 6);
        return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`;
      }
      case 'month':
        return format(currentDate, 'MMMM yyyy');
      case 'agenda':
        return 'Upcoming';
    }
  }, [view, currentDate]);

  return {
    view,
    setView,
    currentDate,
    dateRange,
    weekDates,
    title,
    goToNext,
    goToPrev,
    goToToday,
    goToDate,
  };
}
