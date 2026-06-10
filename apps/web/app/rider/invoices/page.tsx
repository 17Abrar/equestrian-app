'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Receipt,
  ExternalLink,
  CheckCircle2,
  Clock,
  AlertCircle,
  Ban,
  Sparkles,
} from 'lucide-react';
import { fetchJson } from '@/lib/fetch-json';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { safeHref } from '@/lib/safe-href';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { formatCurrency, formatDate } from '@equestrian/shared/utils';
import { STALE_TIME_FREQUENT } from '@equestrian/shared/constants';
import { useBookings, type Booking } from '@/hooks/use-bookings';

type InvoiceStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

interface MyLiveryInvoice {
  id: string;
  clubId: string;
  horseId: string;
  horseName: string;
  clubName: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  amountMinorUnits: number;
  currency: string;
  status: InvoiceStatus;
  dueDate: string;
  paidAt: string | null;
  payLink: string | null;
}

// Audit F-5 (2026-05-07 r5): row-shaped skeleton mirroring InvoiceCard.
function InvoicesListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Card key={i}>
          <CardContent className="flex flex-wrap items-start gap-4 p-4">
            <Skeleton className="h-11 w-11 rounded-md" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-3 w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function useMyLiveryInvoices() {
  return useQuery({
    queryKey: ['me', 'livery-invoices'],
    queryFn: () => fetchJson<ApiSuccessResponse<MyLiveryInvoice[]>>('/api/v1/me/livery-invoices'),
    staleTime: STALE_TIME_FREQUENT,
  });
}

/**
 * Audit P1 (2026-05-26): previously this page only surfaced livery
 * invoices, so a rider who paid for a lesson booking online had no
 * receipt-style ledger anywhere in the app. The rider /bookings page
 * exists but is upcoming-focused. This page now shows BOTH:
 *   - Livery invoices (monthly horse board billing) — unchanged path
 *   - Booking receipts (one-off lesson / package bookings) — derived
 *     from /api/v1/bookings filtered to `paid` and `partial`
 * Each lives in its own section so the rider can scan either ledger
 * without paging through the other.
 *
 * Codex P2 (2026-05-26): /api/v1/bookings is paginated at 50, and the
 * payment-status filter is applied client-side after the fetch — so a
 * rider with >50 bookings only sees the most recent 50 here. The
 * heading copy is RECENT receipts to reflect that. A future PR can
 * add `paymentStatus` to `bookingFiltersSchema` and lift the cap.
 */
export default function RiderInvoicesPage() {
  const livery = useMyLiveryInvoices();
  // Server-side payment-status filter (audit P1 + codex follow-up,
  // 2026-05-26): pull paid and partial bookings in two parallel
  // queries so the receipt ledger isn't bottlenecked by page-1 of
  // upcoming/pending rows. Each query is a single page of 50 ordered
  // by slot date DESC; combined 100 most-recent paid+partial receipts
  // is enough for the typical rider's invoice ledger.
  const paidBookings = useBookings({ paymentStatus: 'paid', pageSize: 50 });
  const partialBookings = useBookings({ paymentStatus: 'partial', pageSize: 50 });

  const liveryInvoices = livery.data?.data ?? [];
  const outstandingLivery = liveryInvoices.filter(
    (i) => i.status === 'pending' || i.status === 'overdue',
  );
  const settledLivery = liveryInvoices.filter((i) => i.status === 'paid');
  const cancelledLivery = liveryInvoices.filter((i) => i.status === 'cancelled');

  const bookingReceipts = useMemo(() => {
    const paid = paidBookings.data && paidBookings.data.success ? paidBookings.data.data : [];
    const partial =
      partialBookings.data && partialBookings.data.success ? partialBookings.data.data : [];
    return [...paid, ...partial].sort((a, b) => (a.slotDate < b.slotDate ? 1 : -1));
  }, [paidBookings.data, partialBookings.data]);

  const liveryError = livery.isError;
  const bookingError = paidBookings.isError || partialBookings.isError;
  // Loading state: show a skeleton while ANY of the three queries is
  // still resolving — codex P3 (2026-05-26). Without this, if livery
  // returns empty first, the page renders just the header for the
  // time it takes the bookings queries to arrive.
  const anyLoading = livery.isLoading || paidBookings.isLoading || partialBookings.isLoading;
  const everythingEmpty =
    !anyLoading &&
    liveryInvoices.length === 0 &&
    bookingReceipts.length === 0 &&
    !liveryError &&
    !bookingError;

  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <div>
        <h1 className="text-2xl font-bold">Invoices</h1>
        <p className="text-muted-foreground">
          Livery bills + receipts for your recent paid bookings.
        </p>
      </div>

      {anyLoading && <InvoicesListSkeleton />}

      {everythingEmpty && (
        <EmptyState
          title="Nothing here yet"
          description="When your stable bills livery or you pay for a lesson online, the records show up here."
          action={{ label: 'Find a stable', href: '/discover' }}
        />
      )}

      {/* Livery invoices */}
      {(outstandingLivery.length > 0 ||
        settledLivery.length > 0 ||
        cancelledLivery.length > 0 ||
        liveryError) && (
        <div className="space-y-4">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            Livery
          </h2>
          {liveryError && !livery.isLoading && (
            <ErrorState
              message={livery.error instanceof Error ? livery.error.message : undefined}
              onRetry={() => livery.refetch()}
            />
          )}
          {outstandingLivery.length > 0 && (
            <LiverySection title="Outstanding" invoices={outstandingLivery} />
          )}
          {settledLivery.length > 0 && <LiverySection title="Paid" invoices={settledLivery} />}
          {cancelledLivery.length > 0 && (
            <LiverySection title="Cancelled" invoices={cancelledLivery} />
          )}
        </div>
      )}

      {/* Booking receipts (audit P1, 2026-05-26) */}
      {(bookingReceipts.length > 0 || bookingError) && (
        <div className="space-y-4">
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            Recent booking receipts
          </h2>
          {bookingError && !paidBookings.isLoading && !partialBookings.isLoading && (
            <ErrorState
              message={
                paidBookings.error instanceof Error
                  ? paidBookings.error.message
                  : partialBookings.error instanceof Error
                    ? partialBookings.error.message
                    : undefined
              }
              onRetry={() => {
                void paidBookings.refetch();
                void partialBookings.refetch();
              }}
            />
          )}
          {bookingReceipts.length > 0 && (
            <div className="space-y-3">
              {bookingReceipts.map((b) => (
                <BookingReceiptCard key={b.id} booking={b} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiverySection({ title, invoices }: { title: string; invoices: MyLiveryInvoice[] }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {title}
        </h3>
        <Badge variant="secondary">{invoices.length}</Badge>
      </div>
      <div className="space-y-3">
        {invoices.map((inv) => (
          <LiveryInvoiceCard key={inv.id} invoice={inv} />
        ))}
      </div>
    </section>
  );
}

function LiveryInvoiceCard({ invoice }: { invoice: MyLiveryInvoice }) {
  const payable = invoice.status === 'pending' || invoice.status === 'overdue';
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start gap-4 p-4">
        <div className="bg-muted rounded-md p-3">
          <Receipt className="text-muted-foreground h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold">{invoice.horseName}</p>
            <LiveryStatusBadge status={invoice.status} />
          </div>
          <p className="text-muted-foreground text-xs">
            {invoice.clubName} · {invoice.invoiceNumber}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {invoice.periodStart} → {invoice.periodEnd}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <p className="text-base font-semibold">
            {formatCurrency(invoice.amountMinorUnits, invoice.currency)}
          </p>
          {invoice.status === 'paid' && invoice.paidAt && (
            <p className="text-muted-foreground text-xs">Paid {formatDate(invoice.paidAt)}</p>
          )}
          {payable && <p className="text-muted-foreground text-xs">Due {invoice.dueDate}</p>}
          {payable && invoice.payLink && (
            <Button size="sm" asChild className="mt-1">
              <a href={safeHref(invoice.payLink)} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Pay now
              </a>
            </Button>
          )}
          {payable && !invoice.payLink && (
            <p className="text-muted-foreground text-xs">Pay link coming from {invoice.clubName}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function BookingReceiptCard({ booking }: { booking: Booking }) {
  const isPartial = booking.paymentStatus === 'partial';
  // `bookings.amount` was NOT NULL after migration 0028 (the column
  // type is still `number | null` in TS — pre-tightening — but every
  // row carries a value). Skip the card if a stale row leaks through
  // rather than rendering NaN. `paymentMethod` and `lessonTypePrice`
  // are intentionally NOT used here: the list projection in
  // `getBookingsByClub` doesn't include them — codex P3 (2026-05-26).
  if (booking.amount === null) return null;
  // Net amount after any partial refund — matches the finance-side
  // accounting (`getRevenueReport` already subtracts the same field).
  // Codex P2 (2026-05-26): without this, a partially-refunded receipt
  // showed the gross captured amount and over-stated what the rider
  // actually paid.
  const netAmount = booking.amount - (booking.refundedAmountMinor ?? 0);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start gap-4 p-4">
        <div className="bg-muted rounded-md p-3">
          <Sparkles className="text-muted-foreground h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold">{booking.lessonTypeName}</p>
            <Badge
              variant="secondary"
              className={
                isPartial
                  ? 'bg-amber-100 text-amber-800 hover:bg-amber-100'
                  : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
              }
            >
              {isPartial ? (
                <AlertCircle className="mr-1 h-3 w-3" />
              ) : (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              )}
              {isPartial ? 'Partially refunded' : 'Paid'}
            </Badge>
          </div>
          <p className="text-muted-foreground text-xs">
            {booking.slotDate} · {booking.slotStartTime}–{booking.slotEndTime}
          </p>
          {booking.arenaName && (
            <p className="text-muted-foreground mt-1 text-xs">{booking.arenaName}</p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1">
          <p className="text-base font-semibold">{formatCurrency(netAmount, booking.currency)}</p>
          {isPartial && (
            <p className="text-muted-foreground text-xs">
              {formatCurrency(booking.refundedAmountMinor, booking.currency)} refunded
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LiveryStatusBadge({ status }: { status: InvoiceStatus }) {
  const map = {
    pending: {
      label: 'Pending',
      className: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
      Icon: Clock,
    },
    paid: {
      label: 'Paid',
      className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
      Icon: CheckCircle2,
    },
    overdue: {
      label: 'Overdue',
      className: 'bg-red-100 text-red-800 hover:bg-red-100',
      Icon: AlertCircle,
    },
    cancelled: {
      label: 'Cancelled',
      className: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
      Icon: Ban,
    },
  } as const;
  const { label, className, Icon } = map[status];
  return (
    <Badge variant="secondary" className={className}>
      <Icon className="mr-1 h-3 w-3" />
      {label}
    </Badge>
  );
}
