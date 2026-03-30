'use client';

import { format } from 'date-fns';
import { CalendarSlotCard } from './calendar-slot-card';
import { type BookingSlot } from '@/hooks/use-bookings';
import { type CalendarCompetition } from '@/hooks/use-competitions';
import { Card, CardContent } from '@/components/ui/card';

const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6am to 10pm

interface DayViewProps {
  date: Date;
  slots: BookingSlot[];
  competitions: CalendarCompetition[];
}

export function DayView({ date, slots, competitions }: DayViewProps) {
  const dateStr = format(date, 'yyyy-MM-dd');
  const daySlots = slots.filter((s) => s.date === dateStr);
  const dayCompetitions = competitions.filter((c) => c.startDate <= dateStr && c.endDate >= dateStr);

  function getSlotsForHour(hour: number): BookingSlot[] {
    const hourStr = String(hour).padStart(2, '0');
    return daySlots.filter((s) => s.startTime.startsWith(hourStr));
  }

  return (
    <Card>
      <CardContent className="p-0">
        {/* Competition banners */}
        {dayCompetitions.length > 0 && (
          <div className="border-b p-3 space-y-2">
            {dayCompetitions.map((comp) => (
              <div
                key={comp.id}
                className="rounded-lg border-2 border-amber-500 bg-amber-50 px-4 py-2"
              >
                <p className="font-semibold text-amber-800">{comp.name}</p>
                {comp.location && (
                  <p className="text-sm text-amber-700">{comp.location}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Hour grid */}
        <div className="divide-y">
          {HOURS.map((hour) => {
            const hourSlots = getSlotsForHour(hour);

            return (
              <div key={hour} className="flex min-h-[64px]">
                <div className="flex w-16 shrink-0 items-start justify-end border-r p-2">
                  <span className="text-xs text-muted-foreground">
                    {String(hour).padStart(2, '0')}:00
                  </span>
                </div>
                <div className="flex-1 p-1">
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {hourSlots.map((slot) => (
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
