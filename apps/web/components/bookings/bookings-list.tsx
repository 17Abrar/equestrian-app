'use client';

import { useState } from 'react';
import { Calendar, Clock } from 'lucide-react';
import { useBookings } from '@/hooks/use-bookings';
import { AddBookingDialog } from './add-booking-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';

import { BOOKING_STATUS_COLORS, PAYMENT_STATUS_COLORS } from '@/lib/ui-constants';

function BookingListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <div className="flex-1">
                <Skeleton className="mb-2 h-5 w-1/3" />
                <Skeleton className="h-4 w-1/2" />
              </div>
              <Skeleton className="h-6 w-20" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function BookingsList() {
  const [status, setStatus] = useState<string | undefined>();
  const [date, setDate] = useState<string>('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useBookings({
    status: status as 'pending' | 'confirmed' | undefined,
    date: date || undefined,
    page,
    pageSize: 25,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bookings</h1>
          <p className="mt-1 text-muted-foreground">View and manage lesson bookings</p>
        </div>
        <AddBookingDialog />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[180px]">
          <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={status ?? 'all'}
          onValueChange={(v) => {
            setStatus(v === 'all' ? undefined : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="no_show">No Show</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {isLoading && <BookingListSkeleton />}

      {isError && (
        <ErrorState
          message={error instanceof Error ? error.message : 'Failed to load bookings'}
          onRetry={() => refetch()}
        />
      )}

      {data && !data.data.length && (
        <EmptyState
          title="No bookings yet"
          description="Bookings will appear here once riders start booking lessons"
        />
      )}

      {data && data.data.length > 0 && (
        <>
          <div className="space-y-3">
            {data.data.map((booking) => (
              <Card key={booking.id} className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-center gap-4 p-4">
                  <div
                    className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg text-white text-xs font-bold"
                    style={{ backgroundColor: '#6366f1' }}
                  >
                    {booking.lessonTypeType.slice(0, 3).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-semibold">
                        {booking.lessonTypeName}
                      </h3>
                      <Badge
                        variant="secondary"
                        className={BOOKING_STATUS_COLORS[booking.status] ?? ''}
                      >
                        {booking.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {booking.slotDate}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {booking.slotStartTime} - {booking.slotEndTime}
                      </span>
                      {booking.riderName && <span>{booking.riderName}</span>}
                      {booking.horseName && <span>{booking.horseName}</span>}
                      {booking.arenaName && <span>{booking.arenaName}</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {booking.amount !== null && (
                      <span className="font-semibold">
                        {(booking.amount / 100).toFixed(2)} {booking.currency}
                      </span>
                    )}
                    <Badge
                      variant="outline"
                      className={PAYMENT_STATUS_COLORS[booking.paymentStatus] ?? ''}
                    >
                      {booking.paymentStatus}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {data.pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
