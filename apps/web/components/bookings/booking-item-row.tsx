'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, Clock, Hourglass, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { type Booking } from '@/hooks/use-bookings';
import { formatTime } from '@equestrian/shared/utils';

type BookingTone = 'tinted' | 'plain';

interface BookingItemRowProps {
  booking: Booking;
  /** Override the auto-tone — by default confirmed → tinted, others → plain. */
  tone?: BookingTone;
  /** When set, the entire row becomes a Next.js Link. Mutually exclusive with `right`. */
  href?: string;
  /** Right-side slot for callers that need an action menu (admin). Suppresses chevron. */
  right?: ReactNode;
}

interface IconStyle {
  Icon: typeof CheckCircle2;
  color: string;
}

function iconForStatus(status: Booking['status']): IconStyle {
  switch (status) {
    case 'confirmed':
      return { Icon: CheckCircle2, color: 'text-emerald-500' };
    case 'completed':
      return { Icon: CheckCircle2, color: 'text-muted-foreground' };
    case 'pending':
      return { Icon: Hourglass, color: 'text-amber-500' };
    case 'cancelled':
    case 'no_show':
      return { Icon: XCircle, color: 'text-muted-foreground' };
    default:
      return { Icon: Clock, color: 'text-muted-foreground' };
  }
}

function autoTone(status: Booking['status']): BookingTone {
  return status === 'confirmed' ? 'tinted' : 'plain';
}

function metaSecondLine(booking: Booking): string | null {
  const parts = [booking.horseName, booking.arenaName].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function dateChip(slotDate: string): string {
  return format(new Date(`${slotDate}T00:00:00`), 'd MMM');
}

function RowBody({ booking }: { booking: Booking }) {
  const { Icon, color } = iconForStatus(booking.status);
  const secondLine = metaSecondLine(booking);
  const isCancelled = booking.status === 'cancelled' || booking.status === 'no_show';

  return (
    <div className={cn('flex items-center gap-3 p-4', isCancelled && 'opacity-60')}>
      <Icon className={cn('h-5 w-5 shrink-0', color)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{booking.lessonTypeName}</p>
        {booking.riderName && (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{booking.riderName}</p>
        )}
        {secondLine && (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">{secondLine}</p>
        )}
      </div>
      <div className="text-muted-foreground flex flex-col items-end gap-0.5 text-xs">
        <span className="text-foreground text-sm font-medium">{dateChip(booking.slotDate)}</span>
        <span>{formatTime(booking.slotStartTime)}</span>
      </div>
    </div>
  );
}

export function BookingItemRow({ booking, tone, href, right }: BookingItemRowProps) {
  const effectiveTone = tone ?? autoTone(booking.status);
  const baseClass = cn(
    'flex items-stretch rounded-xl border transition-colors',
    effectiveTone === 'tinted' ? 'bg-muted/50 border-transparent' : 'bg-card hover:bg-accent/40',
  );

  if (right) {
    return (
      <div className={baseClass}>
        <div className="flex-1">
          <RowBody booking={booking} />
        </div>
        <div className="flex items-center pr-2">{right}</div>
      </div>
    );
  }

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          baseClass,
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        )}
      >
        <div className="flex-1">
          <RowBody booking={booking} />
        </div>
        <ChevronRight className="text-muted-foreground my-auto mr-3 h-4 w-4 shrink-0" />
      </Link>
    );
  }

  return (
    <div className={baseClass}>
      <RowBody booking={booking} />
    </div>
  );
}
