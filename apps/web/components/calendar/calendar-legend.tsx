'use client';

import { LESSON_TYPE_COLORS } from '@/lib/ui-constants';
import { type BookingSlot } from '@/hooks/use-bookings';
import { type CalendarCompetition } from '@/hooks/use-competitions';

interface CalendarLegendProps {
  slots: BookingSlot[];
  competitions: CalendarCompetition[];
}

export function CalendarLegend({ slots, competitions }: CalendarLegendProps) {
  const uniqueTypes = Array.from(
    new Map(
      slots.map((s) => [
        s.lessonTypeType,
        {
          name: s.lessonTypeName,
          color: s.lessonTypeColor ?? LESSON_TYPE_COLORS[s.lessonTypeType] ?? '#6366f1',
        },
      ]),
    ).entries(),
  );

  if (uniqueTypes.length === 0 && competitions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {uniqueTypes.map(([type, { name, color }]) => (
        <div key={type} className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
          <span className="text-xs text-muted-foreground">{name}</span>
        </div>
      ))}
      {competitions.length > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-sm border-2 border-amber-500 bg-amber-100" />
          <span className="text-xs text-muted-foreground">Competition</span>
        </div>
      )}
    </div>
  );
}
