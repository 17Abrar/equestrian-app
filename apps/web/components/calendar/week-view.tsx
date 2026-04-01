'use client';

import { format, isSameDay } from 'date-fns';
import { CalendarSlotCard } from './calendar-slot-card';
import { type BookingSlot } from '@/hooks/use-bookings';
import { type CalendarCompetition } from '@/hooks/use-competitions';
import { Card, CardContent } from '@/components/ui/card';

interface WeekViewProps {
  weekDates: Date[];
  slots: BookingSlot[];
  competitions: CalendarCompetition[];
}

export function WeekView({ weekDates, slots, competitions }: WeekViewProps) {
  const today = new Date();

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
        <div className="grid grid-cols-7 divide-x overflow-hidden rounded-lg">
          {weekDates.map((date) => {
            const isToday = isSameDay(date, today);
            const daySlots = getSlotsForDate(date);
            const dayCompetitions = getCompetitionsForDate(date);

            return (
              <div key={date.toISOString()} className="min-w-0">
                {/* Day header */}
                <div className={`border-b p-2 text-center ${isToday ? 'bg-primary/5' : 'bg-card'}`}>
                  <p className="text-xs text-muted-foreground">{format(date, 'EEE')}</p>
                  <p
                    className={`text-sm font-semibold ${
                      isToday
                        ? 'rounded-full bg-primary text-primary-foreground mx-auto w-7 h-7 flex items-center justify-center'
                        : ''
                    }`}
                  >
                    {format(date, 'd')}
                  </p>
                </div>

                {/* Content */}
                <div className="relative min-h-[600px] bg-card">
                  {daySlots.length === 0 && dayCompetitions.length === 0 && (
                    <div className="flex h-full items-center justify-center p-2">
                      <p className="text-xs text-muted-foreground/50">No lessons</p>
                    </div>
                  )}
                  <div className="space-y-1 p-1">
                    {dayCompetitions.map((comp) => (
                      <div
                        key={comp.id}
                        className="rounded-md border-2 border-amber-500 bg-amber-50 p-1.5 text-xs"
                      >
                        <p className="font-semibold text-amber-800 truncate">{comp.name}</p>
                      </div>
                    ))}
                    {daySlots.map((slot) => (
                      <CalendarSlotCard key={slot.id} slot={slot} />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
