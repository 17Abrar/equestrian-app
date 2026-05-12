'use client';

import { cn } from '@/lib/utils';

interface BookingDayStripProps {
  /** Each entry is YYYY-MM-DD in the user's local timezone — see toDateString in rider/book/page.tsx. */
  dates: string[];
  /** Currently-selected date (YYYY-MM-DD). */
  selected: string | null;
  onSelect: (date: string) => void;
  /** Optional: any date strictly before this is rendered disabled. YYYY-MM-DD. */
  disabledBefore?: string;
  /** Optional badge below the day number — e.g. slot count for that day. */
  slotCounts?: Record<string, number>;
  className?: string;
}

const WEEKDAY_LETTERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

function getTodayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function weekdayLetter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const idx = (d.getDay() + 6) % 7;
  return WEEKDAY_LETTERS[idx]!;
}

function dayNumber(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getDate();
}

export function BookingDayStrip({
  dates,
  selected,
  onSelect,
  disabledBefore,
  slotCounts,
  className,
}: BookingDayStripProps) {
  const today = getTodayLocal();

  return (
    <div
      className={cn('flex gap-1 overflow-x-auto pb-1', className)}
      role="radiogroup"
      aria-label="Pick a date"
    >
      {dates.map((dateStr) => {
        const isSelected = dateStr === selected;
        const isToday = dateStr === today;
        const isDisabled = !!disabledBefore && dateStr < disabledBefore;
        const count = slotCounts?.[dateStr];

        return (
          <button
            key={dateStr}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
            disabled={isDisabled}
            onClick={() => onSelect(dateStr)}
            className={cn(
              'flex min-w-[3rem] flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs transition-colors',
              isDisabled
                ? 'cursor-not-allowed opacity-40'
                : 'hover:bg-accent focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-2',
            )}
          >
            <span className="text-muted-foreground text-[10px] font-medium uppercase">
              {weekdayLetter(dateStr)}
            </span>
            <span
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold tabular-nums',
                isSelected && 'bg-primary text-primary-foreground',
                !isSelected && isToday && 'border-primary border',
              )}
            >
              {dayNumber(dateStr)}
            </span>
            {typeof count === 'number' && count > 0 ? (
              <span
                className={cn(
                  'text-[10px]',
                  isSelected ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {count}
              </span>
            ) : (
              <span className="h-3" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}
