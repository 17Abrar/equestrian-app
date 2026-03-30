'use client';

import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  addDays,
  isSameMonth,
  isSameDay,
} from 'date-fns';
import { CalendarSlotCard } from './calendar-slot-card';
import { type BookingSlot } from '@/hooks/use-bookings';
import { type CalendarCompetition } from '@/hooks/use-competitions';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface MonthViewProps {
  currentDate: Date;
  slots: BookingSlot[];
  competitions: CalendarCompetition[];
  onDayClick: (date: Date) => void;
}

export function MonthView({ currentDate, slots, competitions, onDayClick }: MonthViewProps) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
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

  function getSlotsForDate(date: Date): BookingSlot[] {
    const dateStr = format(date, 'yyyy-MM-dd');
    return slots.filter((s) => s.date === dateStr);
  }

  function getCompetitionsForDate(date: Date): CalendarCompetition[] {
    const dateStr = format(date, 'yyyy-MM-dd');
    return competitions.filter((c) => c.startDate <= dateStr && c.endDate >= dateStr);
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
