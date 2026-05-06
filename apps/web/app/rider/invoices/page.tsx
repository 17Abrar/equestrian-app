'use client';

import { useQuery } from '@tanstack/react-query';
import { Receipt, ExternalLink, CheckCircle2, Clock, AlertCircle, Ban } from 'lucide-react';
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

// Audit E-7: shared fetchJson helper.
function useMyLiveryInvoices() {
  return useQuery({
    queryKey: ['me', 'livery-invoices'],
    queryFn: () =>
      fetchJson<ApiSuccessResponse<MyLiveryInvoice[]>>('/api/v1/me/livery-invoices'),
    staleTime: STALE_TIME_FREQUENT,
  });
}

export default function RiderInvoicesPage() {
  const { data, isLoading, isError, error, refetch } = useMyLiveryInvoices();
  const invoices = data?.data ?? [];

  const outstanding = invoices.filter(
    (i) => i.status === 'pending' || i.status === 'overdue',
  );
  const settled = invoices.filter((i) => i.status === 'paid');
  const cancelled = invoices.filter((i) => i.status === 'cancelled');

  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <div>
        <h1 className="text-2xl font-bold">Livery invoices</h1>
        <p className="text-muted-foreground">Your monthly livery invoices across your stables</p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      )}

      {isError && !isLoading && (
        <ErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={refetch}
        />
      )}

      {!isLoading && !isError && invoices.length === 0 && (
        <EmptyState
          title="No invoices yet"
          description="Your stable bills livery monthly from your horse's billing anniversary. Nothing to show just yet."
        />
      )}

      {outstanding.length > 0 && <Section title="Outstanding" invoices={outstanding} />}
      {settled.length > 0 && <Section title="Paid" invoices={settled} />}
      {cancelled.length > 0 && <Section title="Cancelled" invoices={cancelled} />}
    </div>
  );
}

function Section({
  title,
  invoices,
}: {
  title: string;
  invoices: MyLiveryInvoice[];
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
        <Badge variant="secondary">{invoices.length}</Badge>
      </div>
      <div className="space-y-3">
        {invoices.map((inv) => (
          <InvoiceCard key={inv.id} invoice={inv} />
        ))}
      </div>
    </section>
  );
}

function InvoiceCard({ invoice }: { invoice: MyLiveryInvoice }) {
  const payable = invoice.status === 'pending' || invoice.status === 'overdue';
  return (
    <Card>
      <CardContent className="flex flex-wrap items-start gap-4 p-4">
        <div className="rounded-md bg-muted p-3">
          <Receipt className="h-5 w-5 text-muted-foreground" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold">{invoice.horseName}</p>
            <StatusBadge status={invoice.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            {invoice.clubName} · {invoice.invoiceNumber}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {invoice.periodStart} → {invoice.periodEnd}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <p className="text-base font-semibold">
            {formatCurrency(invoice.amountMinorUnits, invoice.currency)}
          </p>
          {invoice.status === 'paid' && invoice.paidAt && (
            <p className="text-xs text-muted-foreground">
              Paid {formatDate(invoice.paidAt)}
            </p>
          )}
          {payable && (
            <p className="text-xs text-muted-foreground">Due {invoice.dueDate}</p>
          )}
          {payable && invoice.payLink && (
            <Button size="sm" asChild className="mt-1">
              {/* Audit F-18 (2026-05-06): server-stored URL still goes
                  through safeHref — defense-in-depth at the render
                  boundary. Mirrors the helper's adoption in
                  livery-tab.tsx, subscription-panel.tsx, etc. */}
              <a
                href={safeHref(invoice.payLink)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Pay now
              </a>
            </Button>
          )}
          {payable && !invoice.payLink && (
            <p className="text-xs text-muted-foreground">
              Pay link coming from {invoice.clubName}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: InvoiceStatus }) {
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
