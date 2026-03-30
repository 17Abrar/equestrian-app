'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type CalendarView } from '@/hooks/use-calendar-state';

interface CalendarToolbarProps {
  title: string;
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function CalendarToolbar({
  title,
  view,
  onViewChange,
  onPrev,
  onNext,
  onToday,
}: CalendarToolbarProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={onPrev} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={onToday}>
          Today
        </Button>
        <Button variant="outline" size="icon" onClick={onNext} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <h2 className="ml-2 text-lg font-semibold">{title}</h2>
      </div>

      <Tabs value={view} onValueChange={(v) => onViewChange(v as CalendarView)}>
        <TabsList>
          <TabsTrigger value="day">Day</TabsTrigger>
          <TabsTrigger value="week">Week</TabsTrigger>
          <TabsTrigger value="month">Month</TabsTrigger>
          <TabsTrigger value="agenda">Agenda</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
