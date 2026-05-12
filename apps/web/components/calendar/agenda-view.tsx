'use client';

import { format, parseISO, isToday, isTomorrow } from 'date-fns';
import { Clock, MapPin } from 'lucide-react';
import { type BookingSlot } from '@/hooks/use-bookings';
import { getCapacityInfo, CAPACITY_BADGE_CLASSES } from '@/lib/capacity';
import { type CalendarCompetition } from '@/hooks/use-competitions';
import { LESSON_TYPE_COLORS } from '@/lib/ui-constants';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/shared/empty-state';

interface AgendaViewProps {
  slots: BookingSlot[];
  competitions: CalendarCompetition[];
}

// Audit F-22 (2026-05-07 r4): tag the union on the variant itself so
// `item.data` narrows automatically inside each branch — drops the four
// `as BookingSlot` / `as CalendarCompetition` casts in the render below.
type AgendaItem =
  | { type: 'slot'; date: string; sortKey: string; data: BookingSlot }
  | { type: 'competition'; date: string; sortKey: string; data: CalendarCompetition };

function formatDateLabel(dateStr: string): string {
  const date = parseISO(dateStr);
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'EEEE, MMM d');
}

export function AgendaView({ slots, competitions }: AgendaViewProps) {
  // Merge slots and competitions into a single sorted list
  const items: AgendaItem[] = [
    ...slots.map((s) => ({
      type: 'slot' as const,
      date: s.date,
      sortKey: `${s.date}T${s.startTime}`,
      data: s,
    })),
    ...competitions.map((c) => ({
      type: 'competition' as const,
      date: c.startDate,
      sortKey: `${c.startDate}T00:00`,
      data: c,
    })),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  if (items.length === 0) {
    return (
      <EmptyState
        title="No upcoming events"
        description="There are no lessons or competitions scheduled."
      />
    );
  }

  // Group by date
  const grouped = new Map<string, AgendaItem[]>();
  for (const item of items) {
    if (!grouped.has(item.date)) {
      grouped.set(item.date, []);
    }
    grouped.get(item.date)!.push(item);
  }

  return (
    <div className="space-y-6">
      {Array.from(grouped.entries()).map(([date, dateItems]) => (
        <div key={date}>
          <h3 className="text-muted-foreground mb-2 text-sm font-semibold">
            {formatDateLabel(date)}
          </h3>
          <div className="space-y-2">
            {dateItems.map((item) =>
              item.type === 'slot' ? (
                <SlotAgendaItem key={`slot-${item.data.id}`} slot={item.data} />
              ) : (
                <CompetitionAgendaItem key={`comp-${item.data.id}`} competition={item.data} />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SlotAgendaItem({ slot }: { slot: BookingSlot }) {
  const color = slot.lessonTypeColor ?? LESSON_TYPE_COLORS[slot.lessonTypeType] ?? '#6366f1';

  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-3">
        <div className="h-10 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{slot.lessonTypeName}</p>
          <div className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              {slot.startTime.slice(0, 5)} – {slot.endTime.slice(0, 5)}
            </span>
            {slot.arenaName && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {slot.arenaName}
              </span>
            )}
            {(() => {
              const cap = getCapacityInfo(slot.currentRiders, slot.maxRiders);
              return (
                <Badge className={`text-xs ${CAPACITY_BADGE_CLASSES[cap.color]}`}>
                  {cap.label}
                </Badge>
              );
            })()}
          </div>
        </div>
        {slot.coachName && (
          <Badge variant="outline" className="shrink-0">
            {slot.coachName}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

function CompetitionAgendaItem({ competition }: { competition: CalendarCompetition }) {
  return (
    <Card className="border-amber-200">
      <CardContent className="flex items-center gap-4 p-3">
        <div className="h-10 w-1 shrink-0 rounded-full bg-amber-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-medium">{competition.name}</p>
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Competition</Badge>
          </div>
          <div className="text-muted-foreground mt-0.5 flex gap-4 text-sm">
            {competition.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {competition.location}
              </span>
            )}
            {competition.endDate !== competition.startDate && (
              <span>Until {competition.endDate}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
