'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useBookings, type Booking } from '@/hooks/use-bookings';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { BookingItemRow } from '@/components/bookings/booking-item-row';
import { BookingDayStrip } from '@/components/bookings/booking-day-strip';
import { BookingFab } from '@/components/bookings/booking-fab';

function getTodayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getCurrentWeekDates(): string[] {
  const today = new Date();
  const dayOfWeek = today.getDay() || 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - dayOfWeek + 1);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });
}

function compareByDateAsc(a: Booking, b: Booking): number {
  const c = a.slotDate.localeCompare(b.slotDate);
  return c !== 0 ? c : a.slotStartTime.localeCompare(b.slotStartTime);
}

function compareByDateDesc(a: Booking, b: Booking): number {
  const c = b.slotDate.localeCompare(a.slotDate);
  return c !== 0 ? c : b.slotStartTime.localeCompare(a.slotStartTime);
}

function RowListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex items-center gap-3 p-4">
            <Skeleton className="h-5 w-5 rounded-full" />
            <div className="flex-1">
              <Skeleton className="mb-2 h-4 w-2/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-3 w-10" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function BookingsList({ items }: { items: Booking[] }) {
  return (
    <div className="space-y-3">
      {items.map((booking) => (
        <BookingItemRow
          key={booking.id}
          booking={booking}
          href={`/rider/bookings/${booking.id}`}
        />
      ))}
    </div>
  );
}

export default function RiderBookingsPage() {
  const today = getTodayLocal();
  const [agendaDate, setAgendaDate] = useState<string>(today);

  // Single query feeds all three tabs — TanStack Query caches it once.
  // Page size 50 covers riders with even very active schedules; pagination
  // can come later if real users hit the ceiling.
  const { data, isLoading, isError, error, refetch } = useBookings({ pageSize: 50 });

  const allBookings = useMemo(() => data?.data ?? [], [data?.data]);

  const upcoming = useMemo(
    () =>
      allBookings
        .filter(
          (b) => (b.status === 'confirmed' || b.status === 'pending') && b.slotDate >= today,
        )
        .sort(compareByDateAsc),
    [allBookings, today],
  );

  const recent = useMemo(
    () =>
      allBookings
        .filter(
          (b) =>
            b.status === 'completed' ||
            b.status === 'cancelled' ||
            b.status === 'no_show' ||
            b.slotDate < today,
        )
        .sort(compareByDateDesc),
    [allBookings, today],
  );

  const weekDates = useMemo(() => getCurrentWeekDates(), []);

  const slotCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of allBookings) {
      if (b.status === 'cancelled' || b.status === 'no_show') continue;
      counts[b.slotDate] = (counts[b.slotDate] ?? 0) + 1;
    }
    return counts;
  }, [allBookings]);

  const agendaItems = useMemo(
    () => allBookings.filter((b) => b.slotDate === agendaDate).sort(compareByDateAsc),
    [allBookings, agendaDate],
  );

  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      <header>
        <h1 className="text-2xl font-bold">My Bookings</h1>
        <p className="text-muted-foreground text-sm">Your lessons across this stable</p>
      </header>

      {isLoading ? (
        <RowListSkeleton />
      ) : isError ? (
        <ErrorState message={error?.message} onRetry={() => refetch()} />
      ) : (
        <Tabs defaultValue="upcoming">
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="upcoming">Upcoming</TabsTrigger>
            <TabsTrigger value="recent">Recent</TabsTrigger>
            <TabsTrigger value="agenda">Agenda</TabsTrigger>
          </TabsList>

          <TabsContent value="upcoming" className="mt-4">
            {upcoming.length === 0 ? (
              <EmptyState
                title="No upcoming lessons"
                description="When you book a lesson it'll show up here."
                action={{ label: 'Book a Lesson', href: '/rider/book' }}
              />
            ) : (
              <BookingsList items={upcoming} />
            )}
          </TabsContent>

          <TabsContent value="recent" className="mt-4">
            {recent.length === 0 ? (
              <EmptyState
                title="Nothing in your history yet"
                description="Past lessons will appear here once you've ridden."
              />
            ) : (
              <BookingsList items={recent} />
            )}
          </TabsContent>

          <TabsContent value="agenda" className="mt-4 space-y-4">
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
                {format(new Date(`${agendaDate}T00:00:00`), 'MMMM yyyy')}
              </p>
              <BookingDayStrip
                dates={weekDates}
                selected={agendaDate}
                onSelect={setAgendaDate}
                slotCounts={slotCounts}
              />
            </div>
            {agendaItems.length === 0 ? (
              <EmptyState
                title="Nothing scheduled"
                description={format(
                  new Date(`${agendaDate}T00:00:00`),
                  "EEEE, MMM d — you're free this day.",
                )}
                action={{ label: 'Book a Lesson', href: '/rider/book' }}
              />
            ) : (
              <BookingsList items={agendaItems} />
            )}
          </TabsContent>
        </Tabs>
      )}

      <BookingFab href="/rider/book" label="Book a lesson" />
    </div>
  );
}
