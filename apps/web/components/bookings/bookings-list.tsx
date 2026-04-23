'use client';

import { useState, useCallback } from 'react';
import {
  Calendar,
  Clock,
  MoreHorizontal,
  XCircle,
  CheckCircle2,
  UserX,
  Undo2,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  useBookings,
  useCancelBooking,
  useMarkNoShow,
  useMarkComplete,
  type Booking,
} from '@/hooks/use-bookings';
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
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';

import { BOOKING_STATUS_COLORS, PAYMENT_STATUS_COLORS } from '@/lib/ui-constants';

// ─── Action Dialog Types ─────────────────────────────────────────────

type ActionType = 'cancel' | 'no_show' | 'complete' | 'refund';

interface ActionDialogState {
  type: ActionType;
  booking: Booking;
}

const ACTION_CONFIG: Record<ActionType, { title: string; description: string; confirmLabel: string; variant: 'default' | 'destructive' }> = {
  cancel: {
    title: 'Cancel Booking',
    description: 'Are you sure you want to cancel this booking? The rider will be notified and any applicable cancellation fee will be applied.',
    confirmLabel: 'Cancel Booking',
    variant: 'destructive',
  },
  no_show: {
    title: 'Mark as No-Show',
    description: 'Mark this rider as a no-show? Any configured no-show fee will be applied and the rider will be notified.',
    confirmLabel: 'Mark No-Show',
    variant: 'destructive',
  },
  complete: {
    title: 'Mark as Completed',
    description: 'Mark this booking as completed?',
    confirmLabel: 'Mark Completed',
    variant: 'default',
  },
  refund: {
    title: 'Refund Payment',
    description: 'Issue a full refund through the payment provider that captured this booking. The booking payment status will flip to "refunded" and a webhook will confirm once the provider processes it.',
    confirmLabel: 'Issue Refund',
    variant: 'destructive',
  },
};

// ─── Skeleton ────────────────────────────────────────────────────────

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

// ─── Action Confirmation Dialog ──────────────────────────────────────

interface ActionDialogProps {
  state: ActionDialogState | null;
  onClose: () => void;
}

function useRefundBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bookingId, reason }: { bookingId: string; reason?: string }) => {
      const res = await fetch(`/api/v1/bookings/${bookingId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { reason } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message ?? 'Refund failed');
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
    },
  });
}

function BookingActionDialog({ state, onClose }: ActionDialogProps) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cancelBooking = useCancelBooking();
  const markNoShow = useMarkNoShow();
  const markComplete = useMarkComplete();
  const refundBooking = useRefundBooking();

  const handleConfirm = useCallback(async () => {
    if (!state) return;
    setIsSubmitting(true);

    try {
      if (state.type === 'cancel') {
        await cancelBooking.mutateAsync({
          bookingId: state.booking.id,
          reason: reason || 'Cancelled by staff',
        });
        toast.success('Booking cancelled');
      } else if (state.type === 'no_show') {
        await markNoShow.mutateAsync(state.booking.id);
        toast.success('Booking marked as no-show');
      } else if (state.type === 'complete') {
        await markComplete.mutateAsync(state.booking.id);
        toast.success('Booking marked as completed');
      } else if (state.type === 'refund') {
        await refundBooking.mutateAsync({
          bookingId: state.booking.id,
          reason: reason || undefined,
        });
        toast.success('Refund issued');
      }
      setReason('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setIsSubmitting(false);
    }
  }, [state, reason, cancelBooking, markNoShow, markComplete, refundBooking, onClose]);

  if (!state) return null;

  const config = ACTION_CONFIG[state.type];

  return (
    <AlertDialog
      open={!!state}
      onOpenChange={(open) => {
        if (!open) {
          setReason('');
          onClose();
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{config.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {config.description}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 text-sm">
          <p><strong>Lesson:</strong> {state.booking.lessonTypeName}</p>
          <p><strong>Date:</strong> {state.booking.slotDate} at {state.booking.slotStartTime}</p>
          {state.booking.riderName && <p><strong>Rider:</strong> {state.booking.riderName}</p>}
        </div>

        {state.type === 'cancel' && (
          <div className="space-y-2">
            <label htmlFor="cancel-reason" className="text-sm font-medium">
              Reason
            </label>
            <Textarea
              id="cancel-reason"
              placeholder="Reason for cancellation..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
        )}

        {state.type === 'refund' && (
          <div className="space-y-2">
            <label htmlFor="refund-reason" className="text-sm font-medium">
              Reason (optional)
            </label>
            <Textarea
              id="refund-reason"
              placeholder="Why are you refunding?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>
            Keep Booking
          </AlertDialogCancel>
          <Button
            variant={config.variant}
            onClick={handleConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Processing...' : config.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

export function BookingsList() {
  const [status, setStatus] = useState<string | undefined>();
  const [date, setDate] = useState<string>('');
  const [page, setPage] = useState(1);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null);

  const { data, isLoading, isError, error, refetch } = useBookings({
    status: status as 'pending' | 'confirmed' | undefined,
    date: date || undefined,
    page,
    pageSize: 25,
  });

  function getAvailableActions(booking: Booking): ActionType[] {
    const actions: ActionType[] = [];
    if (booking.status === 'confirmed' || booking.status === 'pending') {
      actions.push('cancel');
    }
    if (booking.status === 'confirmed') {
      actions.push('complete');
      actions.push('no_show');
    }
    // Refund is available whenever the booking has been paid and isn't
    // already refunded. The API enforces this too, but the menu item should
    // only surface when meaningful.
    if (booking.paymentStatus === 'paid') {
      actions.push('refund');
    }
    return actions;
  }

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
            {data.data.map((booking) => {
              const actions = getAvailableActions(booking);

              return (
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
                    <div className="flex items-center gap-2">
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
                      {actions.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {actions.includes('complete') && (
                              <DropdownMenuItem
                                onClick={() => setActionDialog({ type: 'complete', booking })}
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Mark Completed
                              </DropdownMenuItem>
                            )}
                            {actions.includes('no_show') && (
                              <DropdownMenuItem
                                onClick={() => setActionDialog({ type: 'no_show', booking })}
                              >
                                <UserX className="mr-2 h-4 w-4" />
                                Mark No-Show
                              </DropdownMenuItem>
                            )}
                            {actions.includes('cancel') && (
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setActionDialog({ type: 'cancel', booking })}
                              >
                                <XCircle className="mr-2 h-4 w-4" />
                                Cancel Booking
                              </DropdownMenuItem>
                            )}
                            {actions.includes('refund') && (
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setActionDialog({ type: 'refund', booking })}
                              >
                                <Undo2 className="mr-2 h-4 w-4" />
                                Issue Refund
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
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

      {/* Confirmation Dialog */}
      <BookingActionDialog
        state={actionDialog}
        onClose={() => setActionDialog(null)}
      />
    </div>
  );
}
