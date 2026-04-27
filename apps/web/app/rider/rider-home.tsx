'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Calendar, Clock, MapPin, ArrowRight, X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useBookings, useCancelBooking, useCancelPreview, type Booking } from '@/hooks/use-bookings';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { BOOKING_STATUS_COLORS } from '@/lib/ui-constants';
import { formatMoney, formatDate, formatTime } from '@equestrian/shared/utils';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

function formatAmount(amount: number | null, currency: string): string {
  if (amount === null) return '';
  return formatMoney(amount, currency);
}

interface BookingCardProps {
  booking: Booking;
  onCancel?: (booking: Booking) => void;
}

function BookingCard({ booking, onCancel }: BookingCardProps) {
  const canCancel = booking.status === 'confirmed' || booking.status === 'pending';

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-12 w-12 flex-col items-center justify-center rounded-lg bg-accent text-xs font-medium">
          <span className="text-[10px] uppercase text-muted-foreground">
            {formatDate(booking.slotDate).split(' ')[0]}
          </span>
          <span className="text-lg font-bold leading-tight">
            {formatDate(booking.slotDate).split(' ')[2]}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{booking.lessonTypeName}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(booking.slotDate)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTime(booking.slotStartTime)} – {formatTime(booking.slotEndTime)}
            </span>
            {booking.arenaName && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {booking.arenaName}
              </span>
            )}
          </div>
          {booking.horseName && (
            <p className="mt-1 text-xs text-muted-foreground">
              Horse: <span className="font-medium text-foreground">{booking.horseName}</span>
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <Badge className={BOOKING_STATUS_COLORS[booking.status] ?? ''} variant="secondary">
            {booking.status}
          </Badge>
          {booking.amount !== null && (
            <span className="text-xs text-muted-foreground">
              {formatAmount(booking.amount, booking.currency)}
            </span>
          )}
          {canCancel && onCancel && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation();
                onCancel(booking);
              }}
            >
              <X className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BookingListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
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

// ─── Cancel Dialog ───────────────────────────────────────────────────

interface CancelDialogProps {
  booking: Booking | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CancelDialog({ booking, open, onOpenChange }: CancelDialogProps) {
  const [reason, setReason] = useState('');
  const cancelBooking = useCancelBooking();
  const { data: previewData, isLoading: previewLoading } = useCancelPreview(
    open && booking ? booking.id : null,
  );

  const preview = previewData?.data;

  // Reset reason whenever the dialog opens/closes
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setReason('');
    }
    onOpenChange(nextOpen);
  }, [onOpenChange]);

  function handleConfirmCancel() {
    if (!booking) return;

    cancelBooking.mutate(
      { bookingId: booking.id, reason: reason.trim() || 'Cancelled by rider' },
      {
        onSuccess: () => {
          toast.success('Booking cancelled successfully.');
          handleOpenChange(false);
        },
        onError: (err) => {
          toast.error(err.message || 'Failed to cancel booking.');
        },
      },
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Booking</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to cancel your <strong>{booking?.lessonTypeName}</strong> lesson
            on <strong>{booking ? formatDate(booking.slotDate) : ''}</strong> at{' '}
            <strong>{booking ? formatTime(booking.slotStartTime) : ''}</strong>?
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Fee warning */}
        {previewLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : preview?.isLate && preview.fee > 0 ? (
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-800">Late Cancellation Fee</p>
              <p className="text-sm text-amber-700">
                This booking is within the {preview.cancellationNoticeHours}-hour cancellation window.
                A fee of <strong>{formatAmount(preview.fee, preview.currency)}</strong> will be applied.
              </p>
            </div>
          </div>
        ) : preview && !preview.isLate ? (
          <p className="text-sm text-muted-foreground">No cancellation fee will be applied.</p>
        ) : null}

        {/* Reason input */}
        <div className="space-y-2">
          <label htmlFor="cancel-reason" className="text-sm font-medium">
            Reason (optional)
          </label>
          <Textarea
            id="cancel-reason"
            placeholder="Why are you cancelling?"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancelBooking.isPending}>
            Keep Booking
          </AlertDialogCancel>
          {/* Use a regular Button instead of AlertDialogAction to prevent
              Radix from auto-closing the dialog before the mutation completes. */}
          <Button
            onClick={handleConfirmCancel}
            disabled={cancelBooking.isPending}
            variant="destructive"
          >
            {cancelBooking.isPending ? 'Cancelling...' : 'Confirm Cancellation'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export function RiderHome() {
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);

  // Fetch upcoming bookings (pending and confirmed — both are cancellable)
  const {
    data: upcoming,
    isLoading: upcomingLoading,
    isError: upcomingError,
    error: upcomingErr,
    refetch: refetchUpcoming,
  } = useBookings({ pageSize: 10 });

  // Fetch recent past bookings (completed)
  const {
    data: past,
    isLoading: pastLoading,
  } = useBookings({ status: 'completed', pageSize: 3 });

  // Filter upcoming to only pending/confirmed
  const upcomingBookings = (upcoming?.data ?? []).filter(
    (b) => b.status === 'confirmed' || b.status === 'pending',
  );
  const pastBookings = past?.data ?? [];

  return (
    <div className="space-y-8 pb-20 sm:pb-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Home</h1>
          <p className="text-muted-foreground">Your upcoming lessons and activity</p>
        </div>
        <Button asChild>
          <Link href="/rider/book">
            Book a Lesson
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      {/* Upcoming bookings */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Upcoming Bookings</h2>
        {upcomingLoading ? (
          <BookingListSkeleton />
        ) : upcomingError ? (
          <ErrorState message={upcomingErr?.message} onRetry={refetchUpcoming} />
        ) : upcomingBookings.length === 0 ? (
          <EmptyState
            title="No upcoming bookings"
            description="Book your first lesson to get started."
            action={{ label: 'Book a Lesson', href: '/rider/book' }}
          />
        ) : (
          <div className="space-y-3">
            {upcomingBookings.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                onCancel={setCancelTarget}
              />
            ))}
          </div>
        )}
      </section>

      {/* Recent past bookings */}
      {!pastLoading && pastBookings.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold">Recent Lessons</h2>
          <div className="space-y-3">
            {pastBookings.map((booking) => (
              <BookingCard key={booking.id} booking={booking} />
            ))}
          </div>
        </section>
      )}

      {/* Cancel dialog */}
      <CancelDialog
        booking={cancelTarget}
        open={!!cancelTarget}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
      />
    </div>
  );
}
