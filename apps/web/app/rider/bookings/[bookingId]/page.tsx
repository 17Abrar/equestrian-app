'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  Clock,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { useBooking, type Booking } from '@/hooks/use-bookings';
import { PayBookingDialog } from '@/components/payments/pay-booking-dialog';
import {
  isBookingPaymentActionRequired,
  isOfflinePaymentMethod,
} from '@/lib/payments/payment-methods';
import { formatTime, formatDate, formatPrice } from '@equestrian/shared/utils';

// ─── Page ────────────────────────────────────────────────────────────

export default function RiderBookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = use(params);
  const searchParams = useSearchParams();
  const returningFromPayment = searchParams.get('from') === 'payment';
  const paymentStartFailed = searchParams.get('payment') === 'start-failed';

  const query = useBooking(bookingId);
  const booking = query.data?.success ? query.data.data : null;
  const paymentActionRequired = booking ? isBookingPaymentActionRequired(booking) : false;

  // Poll while we're waiting for a payment to settle — the webhook updates
  // `paymentStatus` out-of-band. Stop polling once we see `paid`/`refunded`/
  // `failed`, or after a two-minute ceiling to avoid spinning forever.
  const shouldPoll =
    !!booking &&
    paymentActionRequired &&
    booking.paymentStatus === 'pending' &&
    !isOfflinePaymentMethod(booking.paymentMethod);

  // Audit MED-14 (2026-05-05): the previous implementation depended on
  // `query` directly. `useQuery` returns a fresh object every render,
  // so the effect re-ran on every render — tearing down the interval,
  // resetting `start`, and never letting the 2-minute ceiling fire.
  // Hoist `start` into a ref so it survives renders, and depend on
  // `query.refetch` (a stable identity) instead of `query`.
  const pollStartedAtRef = useRef<number | null>(null);
  const refetch = query.refetch;
  useEffect(() => {
    if (!shouldPoll) {
      pollStartedAtRef.current = null;
      return;
    }
    if (pollStartedAtRef.current == null) {
      pollStartedAtRef.current = Date.now();
    }
    const interval = window.setInterval(() => {
      const startedAt = pollStartedAtRef.current;
      if (startedAt != null && Date.now() - startedAt > 120_000) {
        window.clearInterval(interval);
        return;
      }
      void refetch();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [shouldPoll, refetch]);

  const [payOpen, setPayOpen] = useState(false);

  // Auto-open the pay dialog when the rider just finished booking and the
  // payment status is still pending — saves them a click. The booking is
  // typically null on first render (query in flight), so depending only on
  // mount would skip the open every time. Use a ref to guarantee single-fire
  // while letting the effect re-run as the query data arrives.
  const hasAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (hasAutoOpenedRef.current) return;
    if (!booking) return;
    if (!paymentActionRequired) return;
    if (booking.paymentStatus !== 'pending') return;
    // If the rider is returning from a redirect-flow payment, let the
    // webhook land rather than immediately reopening the dialog.
    if (returningFromPayment) return;
    if (paymentStartFailed) return;
    setPayOpen(true);
    hasAutoOpenedRef.current = true;
  }, [booking, paymentActionRequired, paymentStartFailed, returningFromPayment]);

  if (query.isLoading) {
    return <BookingSkeleton />;
  }

  if (query.isError) {
    return (
      <ErrorState
        message={query.error?.message ?? 'Could not load booking'}
        onRetry={() => query.refetch()}
      />
    );
  }

  if (!booking) {
    return <ErrorState message="Booking not found" onRetry={() => query.refetch()} />;
  }

  const amountDisplay =
    booking.amount != null
      ? formatPrice(booking.amount, booking.currency)
      : formatPrice(booking.lessonTypePrice, booking.lessonTypeCurrency);

  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/rider">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold">{booking.lessonTypeName}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Booking reference{' '}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">{booking.id.slice(0, 8)}</code>
        </p>
      </div>

      <PaymentBanner
        booking={booking}
        isPolling={shouldPoll}
        returningFromPayment={returningFromPayment}
        onPayClick={() => setPayOpen(true)}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lesson details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center gap-2">
            <Calendar className="text-muted-foreground h-4 w-4" />
            {formatDate(booking.slotDate, 'long')}
          </div>
          <div className="flex items-center gap-2">
            <Clock className="text-muted-foreground h-4 w-4" />
            {formatTime(booking.slotStartTime)} – {formatTime(booking.slotEndTime)}
          </div>
          {booking.arenaName && (
            <div className="flex items-center gap-2">
              <MapPin className="text-muted-foreground h-4 w-4" />
              {booking.arenaName}
            </div>
          )}
          {booking.horseName && (
            <div className="text-sm">
              Horse: <span className="font-medium">{booking.horseName}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t pt-3">
            <span className="text-muted-foreground">Amount</span>
            <span className="text-lg font-semibold">{amountDisplay}</span>
          </div>
        </CardContent>
      </Card>

      <PayBookingDialog
        bookingId={bookingId}
        displayAmount={amountDisplay}
        open={payOpen}
        onOpenChange={setPayOpen}
        onPaid={() => {
          void query.refetch();
        }}
      />
    </div>
  );
}

// ─── Status banner ───────────────────────────────────────────────────

interface PaymentBannerProps {
  booking: Booking;
  isPolling: boolean;
  returningFromPayment: boolean;
  onPayClick: () => void;
}

function PaymentBanner({
  booking,
  isPolling,
  returningFromPayment,
  onPayClick,
}: PaymentBannerProps) {
  const statusLabel = useMemo(() => {
    const base = booking.paymentStatus.replace('_', ' ');
    return base.charAt(0).toUpperCase() + base.slice(1);
  }, [booking.paymentStatus]);

  if (booking.status === 'cancelled') {
    return (
      <Banner tone="muted" title="Booking cancelled">
        This booking has been cancelled. Contact your stable if you think this is wrong.
      </Banner>
    );
  }

  if (booking.paymentStatus === 'paid') {
    return (
      <Banner tone="success" icon={<CheckCircle2 className="h-5 w-5" />} title="Payment received">
        You&apos;re all set. See you at the stable.
      </Banner>
    );
  }

  if (booking.paymentStatus === 'refunded') {
    return (
      <Banner tone="muted" title="Payment refunded">
        Your payment for this booking was refunded.
      </Banner>
    );
  }

  if (booking.paymentStatus === 'partial') {
    return (
      <Banner tone="muted" title="Partial refund issued">
        Part of your payment for this booking was refunded. Contact your stable if you have
        questions about the amount.
      </Banner>
    );
  }

  if (booking.paymentStatus === 'failed') {
    return (
      <Banner tone="error" icon={<AlertCircle className="h-5 w-5" />} title="Payment failed">
        The last payment attempt didn&apos;t go through. You can try again below.
        <div className="mt-3">
          <Button size="sm" onClick={onPayClick}>
            Try again
          </Button>
        </div>
      </Banner>
    );
  }

  if (isOfflinePaymentMethod(booking.paymentMethod)) {
    return (
      <Banner tone="muted" title="Pay at the stable">
        You&apos;ll settle up on arrival. See you there.
      </Banner>
    );
  }

  if ((booking.amount ?? booking.lessonTypePrice) <= 0 && booking.paymentStatus === 'pending') {
    return (
      <Banner tone="success" icon={<CheckCircle2 className="h-5 w-5" />} title="No payment due">
        This booking is covered by a discount or credit. You&apos;re all set.
      </Banner>
    );
  }

  // Pending — the most common path. Vary the copy based on whether the rider
  // just came back from a redirect-flow payment page (waiting for webhook).
  if (returningFromPayment) {
    return (
      <Banner
        tone="info"
        icon={<Loader2 className="h-5 w-5 animate-spin" />}
        title="Confirming your payment…"
      >
        We&apos;re waiting for the payment processor to confirm. This usually takes a few seconds —
        this page will update automatically.
        <Badge variant="secondary" className="ml-2 text-xs">
          {statusLabel}
        </Badge>
      </Banner>
    );
  }

  return (
    <Banner tone="warn" icon={<AlertCircle className="h-5 w-5" />} title="Payment needed">
      Your booking is reserved. Complete payment to confirm.
      {isPolling && (
        <span className="text-muted-foreground ml-2 inline-flex items-center gap-1 text-xs">
          <Loader2 className="h-3 w-3 animate-spin" /> checking…
        </span>
      )}
      <div className="mt-3">
        <Button size="sm" onClick={onPayClick}>
          Pay now
        </Button>
      </div>
    </Banner>
  );
}

interface BannerProps {
  tone: 'success' | 'warn' | 'error' | 'info' | 'muted';
  title: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

function Banner({ tone, title, icon, children }: BannerProps) {
  const toneClass =
    tone === 'success'
      ? 'border-green-200 bg-green-50 text-green-900'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : tone === 'error'
          ? 'border-red-200 bg-red-50 text-red-900'
          : tone === 'info'
            ? 'border-blue-200 bg-blue-50 text-blue-900'
            : 'border-border bg-muted/40 text-foreground';

  return (
    <div className={`flex gap-3 rounded-lg border p-4 ${toneClass}`} role="status">
      {icon}
      <div className="flex-1 text-sm">
        <p className="font-medium">{title}</p>
        <div className="mt-1 text-sm">{children}</div>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────

function BookingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Skeleton className="h-20 w-full" />
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-36" />
        </CardContent>
      </Card>
    </div>
  );
}
