'use client';

import { useMemo } from 'react';
import {
  format,
  startOfMonth,
  startOfWeek,
  addDays,
  isSameMonth,
  isSameDay,
} from 'date-fns';
import { CalendarSlotCard } from './calendar-slot-card';
import { type BookingSlot } from '@/hooks/use-bookings';
import { type CalendarCompetition } from '@/hooks/use-competitions';
import { Card, CardContent } from '@/components/ui/card';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface MonthViewProps {
  currentDate: Date;
  slots: BookingSlot[];
  competitions: CalendarCompetition[];
  onDayClick: (date: Date) => void;
}

export function MonthView({ currentDate, slots, competitions, onDayClick }: MonthViewProps) {
  const monthStart = startOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });

  const today = new Date();

  // Build 6 weeks of dates
  const weeks: Date[][] = [];
  let day = gridStart;
  for (let w = 0; w < 6; w++) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  }

  // Audit F-23 (2026-05-07 r4): the month grid renders 6 × 7 = 42 cells, and
  // every parent state change (navigation, slot click) re-runs the layout.
  // The previous `slots.filter(...)` per cell was O(cells × slots) per render
  // — for a 90-day window with ~30 slots/day, ~113k comparisons each pass.
  // Pre-bucket once by date string; cell lookup drops to O(1).
  const slotsByDate = useMemo(() => {
    const map = new Map<string, BookingSlot[]>();
    for (const s of slots) {
      const arr = map.get(s.date);
      if (arr) arr.push(s);
      else map.set(s.date, [s]);
    }
    return map;
  }, [slots]);

  const competitionsByDate = useMemo(() => {
    const map = new Map<string, CalendarCompetition[]>();
    for (const c of competitions) {
      // Multi-day competitions span every date between start and end. The
      // grid only renders ~42 dates so this is cheap; iterating the spanned
      // range once at memo time is still cheaper than the per-cell scan.
      const start = new Date(`${c.startDate}T00:00:00Z`);
      const end = new Date(`${c.endDate}T00:00:00Z`);
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = d.toISOString().slice(0, 10);
        const arr = map.get(key);
        if (arr) arr.push(c);
        else map.set(key, [c]);
      }
    }
    return map;
  }, [competitions]);

  function getSlotsForDate(date: Date): BookingSlot[] {
    return slotsByDate.get(format(date, 'yyyy-MM-dd')) ?? [];
  }

  function getCompetitionsForDate(date: Date): CalendarCompetition[] {
    return competitionsByDate.get(format(date, 'yyyy-MM-dd')) ?? [];
  }

  return (
    <Card>
      <CardContent className="p-0">
        {/* Header row */}
        <div className="grid grid-cols-7 border-b">
          {WEEKDAYS.map((d) => (
            <div key={d} className="p-2 text-center text-xs font-medium text-muted-foreground">
              {d}
            </div>
          ))}
        </div>

        {/* Weeks */}
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 divide-x border-b last:border-b-0">
            {week.map((d) => {
              const isCurrentMonth = isSameMonth(d, currentDate);
              const isToday = isSameDay(d, today);
              const daySlots = getSlotsForDate(d);
              const dayCompetitions = getCompetitionsForDate(d);
              const slotCount = daySlots.length;

              return (
                <button
                  type="button"
                  key={d.toISOString()}
                  onClick={() => onDayClick(d)}
                  className={`min-h-[100px] p-1.5 text-left transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset ${
                    !isCurrentMonth ? 'opacity-40' : ''
                  }`}
                  aria-label={`${format(d, 'MMMM d')}, ${slotCount} lessons${dayCompetitions.length > 0 ? `, ${dayCompetitions.length} competitions` : ''}`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                      isToday ? 'bg-primary text-primary-foreground' : ''
                    }`}
                  >
                    {format(d, 'd')}
                  </span>

                  <div className="mt-1 space-y-0.5">
                    {dayCompetitions.map((comp) => (
                      <div
                        key={comp.id}
                        className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800 truncate"
                      >
                        {comp.name}
                      </div>
                    ))}
                    {daySlots.slice(0, 3).map((slot) => (
                      <CalendarSlotCard key={slot.id} slot={slot} compact />
                    ))}
                    {daySlots.length > 3 && (
                      <p className="text-[10px] text-muted-foreground">
                        +{daySlots.length - 3} more
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
