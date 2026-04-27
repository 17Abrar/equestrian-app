'use client';

import { useEffect, useState } from 'react';
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { Loader2, ExternalLink, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  usePaymentForBooking,
  type BookingPaymentResult,
} from '@/hooks/use-booking-payment';
import { reportMutationError } from '@/components/shared/report-mutation-error';

// Lazy-load Stripe once per session. loadStripe caches the promise internally.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}

interface PayBookingDialogProps {
  bookingId: string;
  /** Optional amount to display in the header while the payment is being prepared. */
  displayAmount?: string;
  /** Where Stripe returns the browser after inline confirmation (defaults to current URL). */
  returnUrl?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired when the payment successfully settles (Stripe inline path only). */
  onPaid?: () => void;
}

export function PayBookingDialog({
  bookingId,
  displayAmount,
  returnUrl,
  open,
  onOpenChange,
  onPaid,
}: PayBookingDialogProps) {
  const createPayment = usePaymentForBooking();
  const [payment, setPayment] = useState<BookingPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Kick off payment creation when the dialog first opens. Idempotency on the
  // server means reopening produces the same PaymentIntent / order / intent.
  useEffect(() => {
    if (!open) {
      setPayment(null);
      setError(null);
      return;
    }
    if (payment) return;

    let cancelled = false;
    createPayment
      .mutateAsync(bookingId)
      .then((res) => {
        if (cancelled) return;
        if (res.success) {
          setPayment(res.data);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        reportMutationError('payment.create', err, { bookingId });
        setError(err instanceof Error ? err.message : 'Could not start payment');
      });

    return () => {
      cancelled = true;
    };
    // createPayment is a stable mutation object; including payment in deps would
    // loop on state changes. We deliberately only trigger on open/booking change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bookingId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Complete Payment</DialogTitle>
          {displayAmount && (
            <DialogDescription>Amount due: {displayAmount}</DialogDescription>
          )}
        </DialogHeader>

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-medium">Couldn&apos;t start payment</p>
              <p className="mt-1 text-xs">{error}</p>
            </div>
          </div>
        )}

        {!payment && !error && (
          // Skeleton shaped like the inline Stripe PaymentElement (card-number,
          // expiry/CVC row, then the action row) so the dialog doesn't visibly
          // reflow when the real form mounts.
          <div className="space-y-3 py-2">
            <Skeleton className="h-10 w-full rounded-md" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-10 rounded-md" />
              <Skeleton className="h-10 rounded-md" />
            </div>
            <Skeleton className="h-10 w-full rounded-md" />
            <div className="flex justify-end gap-2 pt-2">
              <Skeleton className="h-9 w-20 rounded-md" />
              <Skeleton className="h-9 w-24 rounded-md" />
            </div>
          </div>
        )}

        {payment?.flow === 'inline' && (
          <StripeInlineForm
            clientSecret={payment.clientSecret}
            returnUrl={returnUrl ?? (typeof window !== 'undefined' ? window.location.href : '/')}
            onPaid={() => {
              onPaid?.();
              onOpenChange(false);
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}

        {payment?.flow === 'redirect' && (
          <RedirectFlow paymentUrl={payment.paymentUrl} onCancel={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Stripe inline flow ──────────────────────────────────────────────

interface StripeInlineFormProps {
  clientSecret: string;
  returnUrl: string;
  onPaid: () => void;
  onCancel: () => void;
}

function StripeInlineForm({ clientSecret, returnUrl, onPaid, onCancel }: StripeInlineFormProps) {
  return (
    <Elements
      stripe={getStripePromise()}
      options={{ clientSecret, appearance: { theme: 'stripe' } }}
    >
      <StripePaymentForm returnUrl={returnUrl} onPaid={onPaid} onCancel={onCancel} />
    </Elements>
  );
}

function StripePaymentForm({
  returnUrl,
  onPaid,
  onCancel,
}: {
  returnUrl: string;
  onPaid: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setSubmitError(null);

    // `redirect: if_required` keeps the flow inline for card payments and
    // only redirects when the payment method demands it (3DS, Apple Pay, etc.).
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: 'if_required',
    });

    if (result.error) {
      const message = result.error.message ?? 'Payment failed';
      reportMutationError('payment.confirm', result.error, {
        type: result.error.type,
        code: result.error.code,
      });
      setSubmitError(message);
      toast.error(message);
      setSubmitting(false);
      return;
    }

    if (result.paymentIntent?.status === 'succeeded') {
      toast.success('Payment successful');
      onPaid();
      return;
    }

    // For statuses like `processing` / `requires_action` we fall through —
    // the webhook will finalize things server-side.
    toast.info('Payment is being processed. We’ll email you when it clears.');
    onPaid();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {submitError && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{submitError}</span>
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={!stripe || !elements || submitting}>
          {submitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              Pay now
            </>
          )}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ─── Redirect flow (N-Genius, Ziina) ─────────────────────────────────

function RedirectFlow({
  paymentUrl,
  onCancel,
}: {
  paymentUrl: string;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        You&apos;ll be taken to a secure payment page to complete the charge. After paying,
        you&apos;ll be redirected back to your booking.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            window.location.href = paymentUrl;
          }}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Continue to payment
        </Button>
      </DialogFooter>
    </div>
  );
}
