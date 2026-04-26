'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  User,
  Calendar,
  DollarSign,
  Clock,
  XCircle,
  CheckCircle2,
  Ban,
  ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useRetireHorseOwnership, type Horse } from '@/hooks/use-horses';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { formatCurrency } from '@equestrian/shared/utils';
import { STALE_TIME_FREQUENT } from '@equestrian/shared/constants';
import { reportMutationError } from '@/components/shared/report-mutation-error';

interface LiveryTabProps {
  horse: Horse;
}

interface LiveryInvoice {
  id: string;
  clubId: string;
  horseId: string;
  ownerMemberId: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  amountMinorUnits: number;
  currency: string;
  status: 'pending' | 'paid' | 'overdue' | 'cancelled';
  dueDate: string;
  paidAt: string | null;
  cancelledAt: string | null;
  paymentProvider: string | null;
  providerPaymentId: string | null;
  payLink: string | null;
  createdAt: string;
}

function useHorseLiveryInvoices(horseId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['livery-invoices', 'horse', horseId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/horses/${horseId}/livery-invoices`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          (data as { error?: { message?: string } }).error?.message ??
            'Failed to load invoices',
        );
      }
      return data as ApiSuccessResponse<LiveryInvoice[]>;
    },
    enabled,
    staleTime: STALE_TIME_FREQUENT,
  });
}

function useMarkInvoicePaid(horseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch(`/api/v1/livery-invoices/${invoiceId}/mark-paid`, {
        method: 'PATCH',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          (data as { error?: { message?: string } }).error?.message ??
            'Failed to mark paid',
        );
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['livery-invoices', 'horse', horseId] });
    },
  });
}

function useCancelInvoice(horseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await fetch(`/api/v1/livery-invoices/${invoiceId}/cancel`, {
        method: 'PATCH',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          (data as { error?: { message?: string } }).error?.message ??
            'Failed to cancel',
        );
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['livery-invoices', 'horse', horseId] });
    },
  });
}

export function LiveryTab({ horse }: LiveryTabProps) {
  const [retireOpen, setRetireOpen] = useState(false);
  const [endDate, setEndDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const retire = useRetireHorseOwnership(horse.id);

  const invoicesQuery = useHorseLiveryInvoices(
    horse.id,
    horse.ownershipStatus === 'active' || horse.ownershipStatus === 'retired',
  );

  async function onConfirmRetire() {
    try {
      await retire.mutateAsync(endDate);
      toast.success(`${horse.name}'s ownership retired`);
      setRetireOpen(false);
    } catch (err) {
      reportMutationError('horse_ownership.retire', err, { horseId: horse.id });
      toast.error(err instanceof Error ? err.message : 'Failed to retire');
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Ownership</CardTitle>
          <StatusBadge status={horse.ownershipStatus} />
        </CardHeader>
        <CardContent className="space-y-4">
          {horse.ownershipStatus === 'pending' && (
            <EmptyNote>
              Pending review — approve or decline the registration from the{' '}
              <strong>Horses → Pending approvals</strong> tab.
            </EmptyNote>
          )}

          {horse.ownershipStatus === 'declined' && horse.ownershipDeclineReason && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Decline reason</p>
              <p className="mt-1 whitespace-pre-wrap">{horse.ownershipDeclineReason}</p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              icon={User}
              label="Owner"
              value={horse.ownerName ?? (horse.ownershipStatus === 'active' ? 'School Horse' : '—')}
            />
            <Field
              icon={DollarSign}
              label="Monthly livery fee"
              value={formatFee(horse.monthlyLiveryFeeMinor, horse.clubCurrency ?? 'AED')}
            />
            <Field
              icon={Calendar}
              label="Livery start date"
              value={horse.liveryStartDate ?? '—'}
            />
            <Field
              icon={Calendar}
              label="Livery end date"
              value={horse.liveryEndDate ?? (horse.ownershipStatus === 'active' ? 'Ongoing' : '—')}
            />
          </div>

          {horse.ownershipStatus === 'active' && (
            <div className="flex justify-end pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRetireOpen(true)}
              >
                <Archive className="mr-2 h-4 w-4" />
                Retire ownership
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {(horse.ownershipStatus === 'active' || horse.ownershipStatus === 'retired') && (
        <InvoicesCard
          horseId={horse.id}
          invoicesQuery={invoicesQuery}
        />
      )}

      <AlertDialog open={retireOpen} onOpenChange={setRetireOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire {horse.name}&apos;s ownership?</AlertDialogTitle>
            <AlertDialogDescription>
              Billing stops on the end date you choose. Operational status
              (available / resting / etc.) isn&apos;t affected — mark the horse
              sold or off-site separately if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="end-date">Livery end date</Label>
            <Input
              id="end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retire.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmRetire}
              disabled={retire.isPending}
            >
              {retire.isPending ? 'Retiring…' : 'Retire'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function InvoicesCard({
  horseId,
  invoicesQuery,
}: {
  horseId: string;
  invoicesQuery: ReturnType<typeof useHorseLiveryInvoices>;
}) {
  const markPaid = useMarkInvoicePaid(horseId);
  const cancelInvoice = useCancelInvoice(horseId);
  const [cancelTarget, setCancelTarget] = useState<
    { id: string; invoiceNumber: string } | null
  >(null);

  const invoices = invoicesQuery.data?.data ?? [];

  async function onConfirmCancel() {
    if (!cancelTarget) return;
    try {
      await cancelInvoice.mutateAsync(cancelTarget.id);
      toast.success('Invoice cancelled');
      setCancelTarget(null);
    } catch (err) {
      reportMutationError('livery_invoice.cancel', err, { invoiceId: cancelTarget?.id });
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Livery invoices</CardTitle>
      </CardHeader>
      <CardContent>
        {invoicesQuery.isLoading && <Skeleton className="h-32 w-full" />}

        {invoicesQuery.isError && (
          <p className="text-sm text-destructive">
            Couldn&apos;t load invoices.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => invoicesQuery.refetch()}
            >
              Try again
            </button>
          </p>
        )}

        {!invoicesQuery.isLoading && !invoicesQuery.isError && invoices.length === 0 && (
          <EmptyNote>
            No livery invoices yet. The first invoice is issued automatically
            on this horse&apos;s billing anniversary, or you can wait for the
            next cron run.
          </EmptyNote>
        )}

        {invoices.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs">
                      {inv.invoiceNumber}
                    </TableCell>
                    <TableCell className="text-sm">
                      {inv.periodStart}
                      <span className="text-muted-foreground"> → {inv.periodEnd}</span>
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {formatAmount(inv.amountMinorUnits, inv.currency)}
                    </TableCell>
                    <TableCell>
                      <InvoiceStatusBadge status={inv.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {inv.dueDate}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {inv.payLink && inv.status !== 'paid' && inv.status !== 'cancelled' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            title="Open pay link"
                          >
                            <a
                              href={inv.payLink}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                        {(inv.status === 'pending' || inv.status === 'overdue') && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                markPaid
                                  .mutateAsync(inv.id)
                                  .then(() => toast.success('Marked paid'))
                                  .catch((err) =>
                                    toast.error(
                                      err instanceof Error ? err.message : 'Failed',
                                    ),
                                  );
                              }}
                              disabled={markPaid.isPending}
                              title="Mark paid"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setCancelTarget({
                                  id: inv.id,
                                  invoiceNumber: inv.invoiceNumber,
                                })
                              }
                              disabled={cancelInvoice.isPending}
                              title="Cancel invoice"
                            >
                              <Ban className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel invoice {cancelTarget?.invoiceNumber}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The invoice will be marked cancelled and the cron will stop
              sending reminders for it. This cannot be undone — you&apos;ll
              need to wait for the next billing cycle or create a new one
              manually.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelInvoice.isPending}>
              Keep invoice
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmCancel}
              disabled={cancelInvoice.isPending}
              className="bg-destructive hover:bg-destructive/90"
            >
              {cancelInvoice.isPending ? 'Cancelling…' : 'Cancel invoice'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-md bg-muted p-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function StatusBadge({ status }: { status: Horse['ownershipStatus'] }) {
  const map = {
    pending: {
      label: 'Pending',
      className: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
      Icon: Clock,
    },
    active: {
      label: 'Active',
      className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
      Icon: DollarSign,
    },
    declined: {
      label: 'Declined',
      className: 'bg-red-100 text-red-800 hover:bg-red-100',
      Icon: XCircle,
    },
    retired: {
      label: 'Retired',
      className: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
      Icon: Archive,
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

function InvoiceStatusBadge({ status }: { status: LiveryInvoice['status'] }) {
  const map = {
    pending: { label: 'Pending', className: 'bg-amber-100 text-amber-800 hover:bg-amber-100' },
    paid: { label: 'Paid', className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' },
    overdue: { label: 'Overdue', className: 'bg-red-100 text-red-800 hover:bg-red-100' },
    cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-700 hover:bg-slate-100' },
  } as const;
  const { label, className } = map[status];
  return (
    <Badge variant="secondary" className={className}>
      {label}
    </Badge>
  );
}

function formatFee(minor: number | null, currency: string): string {
  if (minor == null) return '—';
  if (minor === 0) return 'No fee';
  return formatCurrency(minor, currency);
}

function formatAmount(minor: number, currency: string): string {
  return formatCurrency(minor, currency);
}
