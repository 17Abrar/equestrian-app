'use client';

import { toast } from 'sonner';
import { ExternalLink, Loader2, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatCurrency } from '@equestrian/shared/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { safeHref } from '@/lib/safe-href';
import {
  useSubscription,
  useRefreshPayLink,
  type InvoiceStatus,
  type SubscriptionStatus,
  type SubscriptionTier,
  type OutstandingInvoice,
  type SubscriptionInvoice,
} from '@/hooks/use-subscription';

const TIER_LABEL: Record<SubscriptionTier, string> = {
  trial: 'Trial',
  starter: 'Starter',
  growing: 'Growing',
  professional: 'Professional',
};

export function SubscriptionPanel() {
  const { data, isLoading, isError, error, refetch } = useSubscription();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Could not load subscription'}
        onRetry={() => refetch()}
      />
    );
  }

  const summary = data?.success ? data.data : null;
  if (!summary) {
    return <ErrorState message="Subscription not found" />;
  }

  const trialEndsAtDate = summary.trialEndsAt
    ? new Date(summary.trialEndsAt).toISOString().slice(0, 10)
    : null;
  const isTrial = summary.status === 'trialing';

  return (
    <div className="space-y-4">
      <SummaryCard
        tier={summary.tier}
        status={summary.status}
        trialEndsAt={trialEndsAtDate}
        currentTierPriceMinor={summary.currentTierPriceMinor}
        currency={summary.currency}
      />

      {!isTrial && summary.outstanding.length > 0 && (
        <OutstandingCard invoices={summary.outstanding} />
      )}

      <HistoryCard invoices={summary.history} isTrial={isTrial} />
    </div>
  );
}

// ─── Summary card ────────────────────────────────────────────────────

function SummaryCard({
  tier,
  status,
  trialEndsAt,
  currentTierPriceMinor,
  currency,
}: {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentTierPriceMinor: number;
  currency: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{TIER_LABEL[tier]} plan</CardTitle>
            <CardDescription>
              {tier === 'trial'
                ? 'Free trial — no billing until the trial ends.'
                : `${formatCurrency(currentTierPriceMinor, currency)} / month`}
            </CardDescription>
          </div>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent className="text-muted-foreground space-y-1 pb-4 text-sm">
        {trialEndsAt && status === 'trialing' && (
          <p>
            Trial ends <span className="text-foreground font-medium">{trialEndsAt}</span>. Your
            first Cavaliq invoice will arrive on that date.
          </p>
        )}
        {trialEndsAt && status === 'active' && (
          <p>
            Billing anchored to <span className="text-foreground font-medium">{trialEndsAt}</span>.
            Each monthly invoice is issued on that calendar day.
          </p>
        )}
        {status === 'past_due' && (
          <p className="flex items-start gap-2 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>
              You have an overdue Cavaliq invoice. Pay below to keep your stable&apos;s account
              active.
            </span>
          </p>
        )}
        {status === 'cancelled' && (
          <p className="flex items-start gap-2 text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>Your subscription has been cancelled. Contact support to reactivate.</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: SubscriptionStatus }) {
  if (status === 'active') {
    return (
      <Badge className="bg-green-600 text-xs hover:bg-green-700">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Active
      </Badge>
    );
  }
  if (status === 'trialing') {
    return (
      <Badge variant="secondary" className="text-xs">
        Trialing
      </Badge>
    );
  }
  if (status === 'past_due') {
    return <Badge className="bg-amber-600 text-xs hover:bg-amber-700">Past due</Badge>;
  }
  return (
    <Badge variant="destructive" className="text-xs">
      Cancelled
    </Badge>
  );
}

// ─── Outstanding invoices ────────────────────────────────────────────

function OutstandingCard({ invoices }: { invoices: OutstandingInvoice[] }) {
  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader>
        <CardTitle className="text-base">Outstanding invoices</CardTitle>
        <CardDescription>Pay these to keep your subscription active.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {invoices.map((inv) => (
          <OutstandingRow key={inv.id} invoice={inv} />
        ))}
      </CardContent>
    </Card>
  );
}

function OutstandingRow({ invoice }: { invoice: OutstandingInvoice }) {
  const refresh = useRefreshPayLink();

  async function handleRefresh() {
    try {
      const res = await refresh.mutateAsync(invoice.id);
      if (res.success && res.data.payLink) {
        // Open in a new tab so the admin doesn't lose the dashboard.
        // Audit LOW-10: route through safeHref so a malformed/javascript: pay
        // link from the API can never execute in the admin's session.
        const safe = safeHref(res.data.payLink);
        if (safe === '#') {
          toast.error('Pay link URL is invalid');
          return;
        }
        window.open(safe, '_blank', 'noopener,noreferrer');
        toast.success('Pay link generated');
      }
    } catch (err) {
      reportMutationError('subscription.refresh_pay_link', err, { invoiceId: invoice.id });
      toast.error(err instanceof Error ? err.message : 'Could not generate pay link');
    }
  }

  return (
    <div className="bg-background flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{invoice.invoiceNumber}</span>
          <InvoiceStatusBadge status={invoice.status} />
        </div>
        <div className="text-muted-foreground text-xs">
          {invoice.periodStart} → {invoice.periodEnd} · Due {invoice.dueDate}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-semibold">
          {formatCurrency(invoice.amountMinorUnits, invoice.currency)}
        </span>
        {invoice.payLink ? (
          <Button asChild size="sm">
            <a href={safeHref(invoice.payLink)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-2 h-4 w-4" />
              Pay
            </a>
          </Button>
        ) : (
          <Button size="sm" onClick={handleRefresh} disabled={refresh.isPending}>
            {refresh.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Generate pay link
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── History ─────────────────────────────────────────────────────────

function HistoryCard({ invoices, isTrial }: { invoices: SubscriptionInvoice[]; isTrial: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invoice history</CardTitle>
        <CardDescription>
          {isTrial
            ? "You haven't been billed yet — invoices appear here once your trial ends."
            : 'Last 24 invoices.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {invoices.length === 0 ? (
          <div className="text-muted-foreground px-6 pb-6 pt-2 text-sm">No invoices yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.invoiceNumber}</TableCell>
                  <TableCell>{TIER_LABEL[inv.tier]}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {inv.periodStart} → {inv.periodEnd}
                  </TableCell>
                  <TableCell>
                    <InvoiceStatusBadge status={inv.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(inv.amountMinorUnits, inv.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  if (status === 'paid') {
    return (
      <Badge className="bg-green-600 text-xs hover:bg-green-700">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Paid
      </Badge>
    );
  }
  if (status === 'pending') {
    return (
      <Badge variant="secondary" className="text-xs">
        Pending
      </Badge>
    );
  }
  if (status === 'overdue') {
    return <Badge className="bg-amber-600 text-xs hover:bg-amber-700">Overdue</Badge>;
  }
  return (
    <Badge variant="outline" className="text-xs">
      Cancelled
    </Badge>
  );
}
