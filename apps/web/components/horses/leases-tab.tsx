'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Handshake, Clock, CheckCircle2, Ban, Calendar } from 'lucide-react';
import { z } from 'zod';
import {
  type CreateHorseLeaseInput,
  type SetLeaseStatusInput,
} from '@equestrian/shared/schemas';
import { formatMoney, toMinorUnits, getTodayLocalDateString } from '@equestrian/shared/utils';
import { SUPPORTED_CURRENCIES, type SupportedCurrency } from '@equestrian/shared/constants';
import {
  useHorseLeases,
  useCreateHorseLease,
  useTransitionHorseLease,
  type HorseLeaseRow,
  type LeaseStatus,
} from '@/hooks/use-horse-leases';
import { useQuery } from '@tanstack/react-query';
import { fetchJson } from '@/lib/fetch-json';
import { type PaginatedApiResponse } from '@equestrian/shared/types';
import { useClubSettings } from '@/hooks/use-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';

/**
 * Horse leasing admin tab — feature 2026-05-27 PR 2 of 3.
 * See packages/db/src/queries/horse-leases.ts for the data model.
 *
 * Roles: admin/manager only (gated server-side by `horses:update`).
 * The tab renders when the parent horse-profile mounts — the parent
 * route already requires `horses:read`, but the underlying queries
 * here will 403 for coach/groom/vet so the user sees the error state
 * rather than a partial list.
 */

const STATUS_BADGE: Record<LeaseStatus, { label: string; className: string; Icon: typeof Clock }> = {
  pending: {
    label: 'Pending',
    className: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
    Icon: Clock,
  },
  active: {
    label: 'Active',
    className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100',
    Icon: CheckCircle2,
  },
  ended: {
    label: 'Ended',
    className: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
    Icon: Calendar,
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
    Icon: Ban,
  },
};

export function LeasesTab({ horseId }: { horseId: string }) {
  const { data, isLoading, isError, error, refetch } = useHorseLeases(horseId);
  const [addOpen, setAddOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
      />
    );
  }

  const leases = data?.data ?? [];
  const active = leases.filter((l) => l.status === 'active');
  const pending = leases.filter((l) => l.status === 'pending');
  const past = leases.filter((l) => l.status === 'ended' || l.status === 'cancelled');

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Handshake className="text-muted-foreground h-5 w-5" />
          <CardTitle>Leases</CardTitle>
        </div>
        <AddLeaseDialog horseId={horseId} open={addOpen} onOpenChange={setAddOpen} />
      </CardHeader>
      <CardContent>
        {leases.length === 0 ? (
          <EmptyState
            title="No leases yet"
            description="Track half-lease and full-lease arrangements for this horse. Lease records hold the term and monthly fee; billing happens manually for now."
            action={{ label: 'Add Lease', onClick: () => setAddOpen(true) }}
          />
        ) : (
          <div className="space-y-6">
            {active.length > 0 && <LeaseSection title="Active" leases={active} horseId={horseId} />}
            {pending.length > 0 && (
              <LeaseSection title="Pending" leases={pending} horseId={horseId} />
            )}
            {past.length > 0 && <LeaseSection title="Past" leases={past} horseId={horseId} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LeaseSection({
  title,
  leases,
  horseId,
}: {
  title: string;
  leases: HorseLeaseRow[];
  horseId: string;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          {title}
        </h3>
        <Badge variant="secondary">{leases.length}</Badge>
      </div>
      <div className="space-y-3">
        {leases.map((lease) => (
          <LeaseRow key={lease.id} lease={lease} horseId={horseId} />
        ))}
      </div>
    </section>
  );
}

function LeaseRow({ lease, horseId }: { lease: HorseLeaseRow; horseId: string }) {
  const badge = STATUS_BADGE[lease.status];
  const transition = useTransitionHorseLease(horseId, lease.id);
  const [confirm, setConfirm] = useState<null | LeaseStatus>(null);

  async function onConfirm() {
    if (!confirm) return;
    try {
      await transition.mutateAsync({ status: confirm } as SetLeaseStatusInput);
      toast.success(`Lease ${confirm}`);
      setConfirm(null);
    } catch (err) {
      reportMutationError('horse_lease.transition', err, { leaseId: lease.id });
      toast.error(err instanceof Error ? err.message : 'Failed to update lease');
    }
  }

  return (
    <>
      <div className="bg-card rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold capitalize">{lease.leaseType}-lease</p>
              <Badge variant="secondary" className={badge.className}>
                <badge.Icon className="mr-1 h-3 w-3" />
                {badge.label}
              </Badge>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {lease.lesseeName ?? lease.lesseeEmail ?? 'Unknown lessee'}
              {lease.lesseeEmail && lease.lesseeName ? ` · ${lease.lesseeEmail}` : ''}
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {lease.startDate} → {lease.endDate} ·{' '}
              {formatMoney(lease.monthlyFeeMinor, lease.currency)}/month
            </p>
            {lease.notes && (
              <p className="text-muted-foreground mt-2 whitespace-pre-wrap text-xs">
                {lease.notes}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {lease.status === 'pending' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirm('active')}
                  disabled={transition.isPending}
                >
                  Activate
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirm('cancelled')}
                  disabled={transition.isPending}
                  className="text-muted-foreground"
                >
                  Cancel
                </Button>
              </>
            )}
            {lease.status === 'active' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirm('ended')}
                  disabled={transition.isPending}
                >
                  End
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirm('cancelled')}
                  disabled={transition.isPending}
                  className="text-muted-foreground"
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'active' && 'Activate lease?'}
              {confirm === 'ended' && 'End lease?'}
              {confirm === 'cancelled' && 'Cancel lease?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {/* Codex P2 (2026-05-27): copy doesn't promise billing
                  — the lease MVP only tracks state. Automated lease
                  billing is queued for a follow-up. */}
              {confirm === 'active' &&
                `Marks the lease active starting ${lease.startDate}. The system rejects activation if another lease would overlap this period. Billing happens manually for now — issue an invoice outside the system.`}
              {confirm === 'ended' &&
                'Records that the lease completed its term. Lease history is preserved; no automated billing runs from this action.'}
              {confirm === 'cancelled' &&
                'Records that the lease was cancelled before completion. No automated billing runs from this action.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={transition.isPending}>Back</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm} disabled={transition.isPending}>
              {transition.isPending ? 'Saving…' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function AddLeaseDialog({
  horseId,
  open,
  onOpenChange,
}: {
  horseId: string;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const createLease = useCreateHorseLease(horseId);
  const settingsQuery = useClubSettings();
  const clubCurrency = (settingsQuery.data?.data.currency ?? 'AED') as SupportedCurrency;
  // Lessee picker — pulls the minimal club_members projection via
  // `/api/v1/members?role=rider`. Codex P2 (2026-05-27) flagged the
  // earlier `/api/v1/riders` choice because that endpoint returns
  // PHI (medical notes, emergency contact) just to populate a name
  // dropdown — unnecessary data exposure + misleading audit trail.
  // The `members` endpoint returns id/displayName/email only.
  //
  // KNOWN LIMITATION: only `role=rider` for now; horse_owner members
  // can't be selected from the UI. A combined member search picker
  // is queued for a follow-up (the create API already accepts both
  // roles).
  const lesseesQuery = useQuery({
    queryKey: ['members-for-lease-picker', { role: 'rider' }],
    queryFn: () =>
      fetchJson<PaginatedApiResponse<{ id: string; displayName: string | null; email: string | null }>>(
        '/api/v1/members?role=rider&pageSize=50',
      ),
  });

  // FORM SHAPE: monthly fee is held in MAJOR units inside the form
  // (e.g., "1200 AED" → 1200). The Zod create schema expects MINOR
  // units; we convert at submit time. Storing major preserves the
  // typed value when the user toggles currency (codex P2
  // 2026-05-27 — the previous MINOR-in-form layout silently rescaled
  // 1200 AED to 120 KWD on currency change because the integer
  // dropped through the new minor-units divisor).
  const formSchema = z
    .object({
      lesseeMemberId: z.string().uuid('Pick a lessee'),
      leaseType: z.enum(['half', 'full']),
      monthlyFeeMajor: z
        .number({ invalid_type_error: 'Enter a monthly fee' })
        .nonnegative('Cannot be negative'),
      currency: z.string().min(3).max(3),
      startDate: z.string().min(10, 'Pick a start date'),
      endDate: z.string().min(10, 'Pick an end date'),
      notes: z.string().max(2000).optional(),
    })
    .refine((d) => d.startDate <= d.endDate, {
      message: 'End date must be on or after start date',
      path: ['endDate'],
    });
  type FormValues = z.input<typeof formSchema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      lesseeMemberId: '',
      leaseType: 'half',
      monthlyFeeMajor: undefined as unknown as number,
      currency: clubCurrency,
      startDate: getTodayLocalDateString(),
      endDate: '',
      notes: '',
    },
  });

  // Codex P2 (2026-05-27): sync the currency field once settings
  // resolves AND re-sync on form.reset() (which restores stale
  // defaultValues). Only overwrites when the field is pristine, so a
  // deliberate currency choice survives.
  useEffect(() => {
    if (!settingsQuery.data?.success) return;
    const liveCurrency = settingsQuery.data.data.currency as SupportedCurrency;
    if (!liveCurrency) return;
    if (form.getValues('currency') !== liveCurrency && !form.getFieldState('currency').isDirty) {
      form.setValue('currency', liveCurrency);
    }
  }, [settingsQuery.data, form]);

  async function onSubmit(values: FormValues) {
    try {
      // Convert major → minor at the boundary. Server schema
      // validates the minor value + caps at MAX_MONTHLY_LIVERY_FEE_MINOR.
      const payload: CreateHorseLeaseInput = {
        lesseeMemberId: values.lesseeMemberId,
        leaseType: values.leaseType,
        monthlyFeeMinor: toMinorUnits(values.monthlyFeeMajor, values.currency),
        currency: values.currency as SupportedCurrency,
        startDate: values.startDate,
        endDate: values.endDate,
        notes: values.notes,
      };
      await createLease.mutateAsync(payload);
      toast.success('Lease created — review and activate when ready');
      // Codex P2 (2026-05-27): reset WITH the live club currency so
      // a non-AED club doesn't fall back to the stale AED default.
      form.reset({
        lesseeMemberId: '',
        leaseType: 'half',
        monthlyFeeMajor: undefined as unknown as number,
        currency:
          (settingsQuery.data?.success
            ? (settingsQuery.data.data.currency as SupportedCurrency)
            : clubCurrency),
        startDate: getTodayLocalDateString(),
        endDate: '',
        notes: '',
      });
      onOpenChange(false);
    } catch (err) {
      reportMutationError('horse_lease.create', err, { horseId });
      toast.error(err instanceof Error ? err.message : 'Failed to create lease');
    }
  }

  const lesseeList =
    lesseesQuery.data && lesseesQuery.data.success ? lesseesQuery.data.data : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add Lease
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Lease</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="lesseeMemberId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Lessee *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value || undefined}
                    disabled={lesseesQuery.isLoading || lesseeList.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            lesseesQuery.isLoading
                              ? 'Loading riders…'
                              : lesseeList.length === 0
                                ? 'No riders to lease to'
                                : 'Pick a rider…'
                          }
                        />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {lesseeList.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.displayName ?? 'Unnamed'}
                          {m.email ? ` · ${m.email}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="leaseType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="half">Half-lease</SelectItem>
                        <SelectItem value="full">Full-lease</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value ?? clubCurrency}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SUPPORTED_CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="monthlyFeeMajor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Monthly fee *</FormLabel>
                  <FormControl>
                    {/* step=0.01 so fractional fees like 1200.50 don't
                        trip the browser's default integer-only number
                        validation. Codex P3 (2026-05-27). */}
                    <NumberInput
                      placeholder="e.g. 1200"
                      step="0.01"
                      value={field.value}
                      onChange={(v) => field.onChange(v)}
                    />
                  </FormControl>
                  <p className="text-muted-foreground text-xs">
                    Half-lease typically costs half the horse&apos;s monthly upkeep.
                    Full-lease covers the whole thing.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End *</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="Days of access, riding times, etc." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={createLease.isPending}>
              {createLease.isPending ? 'Adding…' : 'Add Lease'}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
