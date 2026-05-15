'use client';

import { useMemo, useState, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
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
import { BookingDayStrip } from './booking-day-strip';
import { BookingItemRow } from './booking-item-row';
import { BookingFab } from './booking-fab';
import { formatMoney } from '@equestrian/shared/utils';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
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
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { fetchJson } from '@/lib/fetch-json';
import type { ApiResponse } from '@equestrian/shared/types';

import { BOOKING_STATUS_COLORS, PAYMENT_STATUS_COLORS, WEEK_STARTS_ON } from '@/lib/ui-constants';
import { DEFAULT_PAGE_SIZE } from '@equestrian/shared/constants';

// ─── Action Dialog Types ─────────────────────────────────────────────

type ActionType = 'cancel' | 'no_show' | 'complete' | 'refund';

interface ActionDialogState {
  type: ActionType;
  booking: Booking;
}

interface RefundBookingResult {
  bookingId: string;
  provider: string;
  providerRefundId: string;
  status: 'pending' | 'succeeded' | 'failed';
  partial: boolean;
  refundedAmountMinor: number;
  remainingRefundableMinor: number;
}

const ACTION_CONFIG: Record<
  ActionType,
  { title: string; description: string; confirmLabel: string; variant: 'default' | 'destructive' }
> = {
  cancel: {
    title: 'Cancel Booking',
    description:
      'Are you sure you want to cancel this booking? The rider will be notified and any applicable cancellation fee will be applied.',
    confirmLabel: 'Cancel Booking',
    variant: 'destructive',
  },
  no_show: {
    title: 'Mark as No-Show',
    description:
      'Mark this rider as a no-show? Any configured no-show fee will be applied and the rider will be notified.',
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
    description:
      'Request a full refund through the payment provider that captured this booking. The booking ledger updates only after the provider reports a succeeded refund.',
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
            <Skeleton className="h-8 w-8 rounded-md" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Date filter helpers ─────────────────────────────────────────────

function toLocalDateString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Audit 2026-05-13 (P1): week-start aligned with calendar via WEEK_STARTS_ON
// (`lib/ui-constants.ts`). Previously the bookings strip hardcoded Monday as
// the week start while the calendar started weeks on Sunday — a UI
// inconsistency for any admin switching between /calendar and /bookings.
function getWeekDates(weekOffset: number): string[] {
  const today = new Date();
  // today.getDay() returns 0..6 with Sunday=0. Offset back to the configured
  // start of the week.
  const dayIndex = (today.getDay() - WEEK_STARTS_ON + 7) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - dayIndex + weekOffset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return toLocalDateString(d);
  });
}

// ─── Action Confirmation Dialog ──────────────────────────────────────

interface ActionDialogProps {
  state: ActionDialogState | null;
  onClose: () => void;
}

function useRefundBooking() {
  const qc = useQueryClient();
  return useMutation({
    // Audit F-4: route through `fetchJson` so the response-shape
    // validator (`ResponseShapeError`) catches a CF Worker HTML error
    // page or a non-envelope response. Previously the bare `fetch` +
    // `res.json()` would resolve a Cloudflare 502 HTML body as a
    // success and skip the `onSuccess` invalidation in subtle ways.
    mutationFn: ({ bookingId, reason }: { bookingId: string; reason?: string }) =>
      fetchJson<ApiResponse<RefundBookingResult>>(`/api/v1/bookings/${bookingId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reason ? { reason } : {}),
      }),
    onSuccess: () => {
      // Audit 2026-05-13 (P1): aligned with the list/detail split in
      // use-bookings.ts. Invalidate both slices so the list and any open
      // detail view refresh after a refund.
      void qc.invalidateQueries({ queryKey: ['bookings', 'list'] });
      void qc.invalidateQueries({ queryKey: ['bookings', 'detail'] });
    },
    // Audit LOW-12 (2026-05-05): hook-level reporter so a backend regression
    // never hides behind the consumer's bare `toast.error` — the call-site
    // already runs `reportMutationError` from its catch, but Sentry dedupes
    // identical fingerprints so the overlap is harmless.
    onError: (err) => reportMutationError('booking.refund', err),
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
        const refundResult = await refundBooking.mutateAsync({
          bookingId: state.booking.id,
          reason: reason || undefined,
        });
        if (!refundResult.success) {
          throw new Error(refundResult.error.message);
        }
        if (refundResult.data.status === 'pending') {
          toast.warning(
            'Refund requested. Booking ledger will update after provider confirmation.',
          );
        } else {
          toast.success('Refund issued');
        }
      }
      setReason('');
      onClose();
    } catch (err) {
      reportMutationError('booking.action', err, {
        type: state?.type,
        bookingId: state?.booking.id,
      });
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
          <AlertDialogDescription>{config.description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 text-sm">
          <p>
            <strong>Lesson:</strong> {state.booking.lessonTypeName}
          </p>
          <p>
            <strong>Date:</strong> {state.booking.slotDate} at {state.booking.slotStartTime}
          </p>
          {state.booking.riderName && (
            <p>
              <strong>Rider:</strong> {state.booking.riderName}
            </p>
          )}
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
          <AlertDialogCancel disabled={isSubmitting}>Keep Booking</AlertDialogCancel>
          <Button variant={config.variant} onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? 'Processing...' : config.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main Component ──────────────────────────────────────────────────

interface BookingsListProps {
  /**
   * Audit MED (2026-05-05 pass 2): server-determined `bookings:create`
   * gate. When false, the "Add Booking" affordance is hidden — coaches
   * (who hold `read` + `update_own` but not `create`) no longer see a
   * button that clicks straight to a 403.
   */
  canCreate?: boolean;
}

// Audit LOW (2026-05-05 pass 2): mirror the full booking-status union
// from `bookingFiltersSchema`. The previous `as 'pending' | 'confirmed'`
// was a cast lie — the Select offers `completed`/`cancelled`/`no_show`
// too. Keep all five so picking "Completed" or "Cancelled" routes the
// real value to the API rather than slipping through as the broken
// narrow type.
const BOOKING_STATUS_FILTER_VALUES = [
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;
type BookingStatusFilter = (typeof BOOKING_STATUS_FILTER_VALUES)[number] | undefined;

export function BookingsList({ canCreate = true }: BookingsListProps = {}) {
  const [status, setStatus] = useState<BookingStatusFilter>();
  // Day-strip selection IS the date filter. `null` means "any date in the
  // current week" (server returns the global paginated list — useful when the
  // admin wants the recency-sorted view); selecting a day filters server-side.
  const [date, setDate] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null);
  // Audit F-20 (2026-05-07 r4): lift dialog open state so EmptyState CTA
  // can trigger the same Add Booking flow as the header button.
  const [addOpen, setAddOpen] = useState(false);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);
  const weekLabel = useMemo(() => {
    const start = new Date(`${weekDates[0]}T00:00:00`);
    const end = new Date(`${weekDates[6]}T00:00:00`);
    return `${format(start, 'MMM d')} – ${format(end, 'MMM d')}`;
  }, [weekDates]);

  const { data, isLoading, isError, error, refetch } = useBookings({
    status,
    date: date ?? undefined,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
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
          <p className="text-muted-foreground mt-1">View and manage lesson bookings</p>
        </div>
        {canCreate && <AddBookingDialog open={addOpen} onOpenChange={setAddOpen} />}
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWeekOffset((w) => w - 1)}
              aria-label="Previous week"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium tabular-nums">{weekLabel}</span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWeekOffset((w) => w + 1)}
              aria-label="Next week"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {date && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDate(null);
                  setPage(1);
                }}
              >
                Any date
              </Button>
            )}
            <Select
              value={status ?? 'all'}
              onValueChange={(v) => {
                setStatus(
                  v === 'all'
                    ? undefined
                    : BOOKING_STATUS_FILTER_VALUES.includes(
                          v as (typeof BOOKING_STATUS_FILTER_VALUES)[number],
                        )
                      ? (v as (typeof BOOKING_STATUS_FILTER_VALUES)[number])
                      : undefined,
                );
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
        </div>
        <BookingDayStrip
          dates={weekDates}
          selected={date}
          onSelect={(d) => {
            // Toggle off when picking the already-selected day so the admin
            // can return to the un-date-scoped paginated view in one tap.
            setDate((current) => (current === d ? null : d));
            setPage(1);
          }}
        />
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
          action={
            canCreate ? { label: 'Create booking', onClick: () => setAddOpen(true) } : undefined
          }
        />
      )}

      {data && data.data.length > 0 && (
        <>
          <div className="space-y-3">
            {data.data.map((booking) => {
              const actions = getAvailableActions(booking);

              return (
                <BookingItemRow
                  key={booking.id}
                  booking={booking}
                  right={
                    <div className="flex items-center gap-2 pl-2">
                      <div className="hidden flex-col items-end gap-1 sm:flex">
                        {booking.amount !== null && (
                          <span className="text-sm font-semibold">
                            {formatMoney(booking.amount, booking.currency)}
                          </span>
                        )}
                        <Badge
                          variant="outline"
                          className={PAYMENT_STATUS_COLORS[booking.paymentStatus] ?? ''}
                        >
                          {booking.paymentStatus}
                        </Badge>
                      </div>
                      <Badge
                        variant="secondary"
                        className={`hidden md:inline-flex ${BOOKING_STATUS_COLORS[booking.status] ?? ''}`}
                      >
                        {booking.status.replace('_', ' ')}
                      </Badge>
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
                  }
                />
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
              <span className="text-muted-foreground text-sm">
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
      <BookingActionDialog state={actionDialog} onClose={() => setActionDialog(null)} />

      {/* FAB — mobile/tablet only; desktop keeps the inline header button. */}
      {canCreate && (
        <BookingFab onClick={() => setAddOpen(true)} label="Add booking" className="lg:hidden" />
      )}
    </div>
  );
}
