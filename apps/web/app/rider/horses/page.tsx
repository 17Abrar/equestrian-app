'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { Plus, Clock, CheckCircle2, XCircle, Archive, RotateCcw, Rabbit, Receipt, Handshake } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { formatCurrency, formatDate } from '@equestrian/shared/utils';
import { STALE_TIME_MEDIUM } from '@equestrian/shared/constants';
import { fetchJson } from '@/lib/fetch-json';

type OwnershipStatus = 'pending' | 'active' | 'retired' | 'declined';

interface MyHorse {
  id: string;
  clubId: string;
  clubName: string;
  clubSlug: string;
  clubCurrency: string;
  name: string;
  breed: string | null;
  gender: string | null;
  color: string | null;
  heightHands: string | null;
  weightKg: string | null;
  skillLevel: 'beginner' | 'intermediate' | 'advanced';
  primaryPhotoUrl: string | null;
  ownershipStatus: OwnershipStatus;
  monthlyLiveryFeeMinor: number | null;
  liveryStartDate: string | null;
  liveryEndDate: string | null;
  ownershipDeclineReason: string | null;
  ownershipSubmittedAt: string | null;
  createdAt: string;
}

interface MyMembership {
  memberId: string;
  clubId: string;
  clubName: string;
  clubSlug: string;
  role: string;
}

interface MyHorsesResponse {
  horses: MyHorse[];
  memberships: MyMembership[];
}

function useMyHorses() {
  return useQuery({
    queryKey: ['me', 'horses'],
    queryFn: () => fetchJson<ApiSuccessResponse<MyHorsesResponse>>('/api/v1/me/horses'),
    staleTime: STALE_TIME_MEDIUM,
  });
}

function useRetireHorse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (horseId: string) =>
      fetchJson<ApiSuccessResponse<{ id: string }>>(`/api/v1/me/horses/${horseId}/retire`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me', 'horses'] });
    },
  });
}

// Audit P1 (2026-05-26): rider-initiated reactivation of a retired
// horse. Flips ownership back to `pending` so the club admin
// re-approves with a fresh livery fee; closes the audit gap where
// reactivation required the rider to DM the stable.
function useReactivateHorse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (horseId: string) =>
      fetchJson<ApiSuccessResponse<{ id: string }>>(`/api/v1/me/horses/${horseId}/reactivate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me', 'horses'] });
    },
  });
}

export default function RiderHorsesPage() {
  const { data, isLoading, isError, error, refetch } = useMyHorses();
  const [retiring, setRetiring] = useState<MyHorse | null>(null);
  const [reactivating, setReactivating] = useState<MyHorse | null>(null);
  const retire = useRetireHorse();
  const reactivate = useReactivateHorse();

  const horses = useMemo(() => data?.data.horses ?? [], [data]);
  const memberships = data?.data.memberships ?? [];
  const canRegister = memberships.length > 0;
  const hasActiveOwnership = horses.some((h) => h.ownershipStatus === 'active');

  const grouped = useMemo(() => {
    const buckets: Record<OwnershipStatus, MyHorse[]> = {
      pending: [],
      active: [],
      retired: [],
      declined: [],
    };
    for (const h of horses) buckets[h.ownershipStatus].push(h);
    return buckets;
  }, [horses]);

  async function onConfirmRetire() {
    if (!retiring) return;
    try {
      await retire.mutateAsync(retiring.id);
      toast.success(`${retiring.name} retired`);
      setRetiring(null);
    } catch (err) {
      reportMutationError('rider.horse.retire', err, { horseId: retiring.id });
      toast.error(err instanceof Error ? err.message : 'Failed to retire');
    }
  }

  async function onConfirmReactivate() {
    if (!reactivating) return;
    try {
      await reactivate.mutateAsync(reactivating.id);
      toast.success(`${reactivating.name} sent back to ${reactivating.clubName} for re-approval`);
      setReactivating(null);
    } catch (err) {
      reportMutationError('rider.horse.reactivate', err, { horseId: reactivating.id });
      toast.error(err instanceof Error ? err.message : 'Failed to reactivate');
    }
  }

  return (
    <div className="space-y-6 pb-20 sm:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My Horses</h1>
          <p className="text-muted-foreground">Horses you own at your stables</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasActiveOwnership && (
            <Button asChild size="sm" variant="outline">
              <Link href="/rider/invoices">
                <Receipt className="mr-2 h-4 w-4" />
                Invoices
              </Link>
            </Button>
          )}
          {canRegister && (
            <Button asChild size="sm">
              <Link href="/rider/horses/new">
                <Plus className="mr-2 h-4 w-4" />
                Register a horse
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Leases — feature 2026-05-27 PR 3 of 3. Hidden when the rider
          has no leases at any club. */}
      <MyLeasesSection />

      {isLoading && <HorsesSkeleton />}

      {isError && !isLoading && (
        <ErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={refetch}
        />
      )}

      {!isLoading &&
        !isError &&
        horses.length === 0 &&
        (canRegister ? (
          <EmptyState
            title="No horses yet"
            description="Own a horse? Register them at your stable to track livery and keep records in one place."
            action={{ label: 'Register a horse', href: '/rider/horses/new' }}
          />
        ) : (
          <EmptyState
            title="Join a stable first"
            description="You need to be a member of a stable before you can register a horse there."
            action={{ label: 'Find a stable', href: '/discover' }}
          />
        ))}

      {!isLoading && !isError && horses.length > 0 && (
        <div className="space-y-8">
          <Section
            title="Pending approval"
            count={grouped.pending.length}
            emptyHint={null}
            horses={grouped.pending}
            onRetire={null}
            onReactivate={null}
          />
          <Section
            title="Active"
            count={grouped.active.length}
            emptyHint={null}
            horses={grouped.active}
            onRetire={(h) => setRetiring(h)}
            onReactivate={null}
          />
          <Section
            title="Declined"
            count={grouped.declined.length}
            emptyHint={null}
            horses={grouped.declined}
            onRetire={null}
            onReactivate={null}
          />
          <Section
            title="Retired"
            count={grouped.retired.length}
            emptyHint={null}
            horses={grouped.retired}
            onRetire={null}
            onReactivate={(h) => setReactivating(h)}
          />
        </div>
      )}

      <AlertDialog open={!!retiring} onOpenChange={(open) => !open && setRetiring(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire {retiring?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops livery billing going forward. You can reactivate from the Retired
              section later — the stable will re-approve with a fresh livery fee.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retire.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmRetire} disabled={retire.isPending}>
              {retire.isPending ? 'Retiring…' : 'Retire'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!reactivating}
        onOpenChange={(open) => !open && setReactivating(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate {reactivating?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {reactivating?.clubName} will see this horse as a pending registration again and
              re-approve with a fresh livery fee. They&apos;ll be notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reactivate.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmReactivate} disabled={reactivate.isPending}>
              {reactivate.isPending ? 'Sending…' : 'Reactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Audit F-50 (2026-05-07 r4): content-shape skeleton mirroring HorseCard's
// avatar block + title row + two metadata rows + status badge layout. The
// previous bare h-40 rectangles caused a visible layout shift when the
// real cards arrived.
function HorseCardSkeleton() {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex gap-4 p-4">
        <Skeleton className="h-20 w-20 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-5 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

function HorsesSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <HorseCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  count: number;
  emptyHint: string | null;
  horses: MyHorse[];
  onRetire: ((h: MyHorse) => void) | null;
  onReactivate: ((h: MyHorse) => void) | null;
}

function Section({ title, count, horses, onRetire, onReactivate }: SectionProps) {
  if (count === 0) return null;
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          {title}
        </h2>
        <Badge variant="secondary">{count}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {horses.map((h) => (
          <HorseCard key={h.id} horse={h} onRetire={onRetire} onReactivate={onReactivate} />
        ))}
      </div>
    </section>
  );
}

function HorseCard({
  horse,
  onRetire,
  onReactivate,
}: {
  horse: MyHorse;
  onRetire: ((h: MyHorse) => void) | null;
  onReactivate: ((h: MyHorse) => void) | null;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex gap-4 p-4">
        <div className="bg-muted relative h-20 w-20 shrink-0 overflow-hidden rounded-lg">
          {horse.primaryPhotoUrl ? (
            <Image
              src={horse.primaryPhotoUrl}
              alt={horse.name}
              fill
              className="object-cover"
              sizes="80px"
            />
          ) : (
            <div className="text-muted-foreground flex h-full w-full items-center justify-center">
              <Rabbit className="h-8 w-8" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{horse.name}</p>
              <p className="text-muted-foreground text-xs">
                {[horse.breed, horse.color].filter(Boolean).join(' · ') || 'No details yet'}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">at {horse.clubName}</p>
            </div>
            <StatusBadge status={horse.ownershipStatus} />
          </div>

          {horse.ownershipStatus === 'pending' && (
            <p className="text-muted-foreground mt-2 text-xs">
              Submitted {horse.ownershipSubmittedAt ? formatDate(horse.ownershipSubmittedAt) : '—'}.
              Waiting for the stable to review.
            </p>
          )}

          {horse.ownershipStatus === 'active' && (
            <div className="mt-2 space-y-0.5 text-xs">
              <p className="text-muted-foreground">
                Livery: {formatFee(horse.monthlyLiveryFeeMinor, horse.clubCurrency)} / month
              </p>
              {horse.liveryStartDate && (
                <p className="text-muted-foreground">Started {horse.liveryStartDate}</p>
              )}
            </div>
          )}

          {horse.ownershipStatus === 'declined' && horse.ownershipDeclineReason && (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
              <p className="font-medium">Declined by {horse.clubName}</p>
              <p className="mt-0.5 whitespace-pre-wrap">{horse.ownershipDeclineReason}</p>
            </div>
          )}

          {horse.ownershipStatus === 'retired' && horse.liveryEndDate && (
            <p className="text-muted-foreground mt-2 text-xs">Retired on {horse.liveryEndDate}</p>
          )}

          {horse.ownershipStatus === 'active' && onRetire && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground mt-2 h-8 px-2 text-xs"
              onClick={() => onRetire(horse)}
            >
              <Archive className="mr-1 h-3.5 w-3.5" />
              Retire
            </Button>
          )}

          {horse.ownershipStatus === 'retired' && onReactivate && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground mt-2 h-8 px-2 text-xs"
              onClick={() => onReactivate(horse)}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reactivate
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: OwnershipStatus }) {
  const map: Record<OwnershipStatus, { label: string; className: string; Icon: typeof Clock }> = {
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
  };
  const { label, className, Icon } = map[status];
  return (
    <Badge variant="secondary" className={className}>
      <Icon className="mr-1 h-3 w-3" />
      {label}
    </Badge>
  );
}

function formatFee(minor: number | null, currency: string): string {
  if (minor == null) return '—';
  if (minor === 0) return 'No fee';
  return formatCurrency(minor, currency);
}

// ─── Leases (feature 2026-05-27 PR 3) ───────────────────────────────

type LeaseType = 'half' | 'full';
type LeaseStatus = 'pending' | 'active' | 'ended' | 'cancelled';

interface MyLeaseRow {
  id: string;
  clubId: string;
  clubName: string;
  clubSlug: string;
  horseId: string;
  horseName: string;
  horsePhotoUrl: string | null;
  leaseType: LeaseType;
  monthlyFeeMinor: number;
  currency: string;
  startDate: string;
  endDate: string;
  status: LeaseStatus;
  notes: string | null;
}

interface MyLeasesResponse {
  leases: MyLeaseRow[];
}

function useMyLeases() {
  return useQuery({
    queryKey: ['me', 'leases'],
    queryFn: () => fetchJson<ApiSuccessResponse<MyLeasesResponse>>('/api/v1/me/leases'),
    staleTime: STALE_TIME_MEDIUM,
  });
}

/**
 * Renders the rider's leases above the owned-horses section on the
 * rider portal. Hidden entirely when the rider has no active or
 * pending leases — keeping the page clean for the common case of
 * "I own horses but don't lease any".
 */
function MyLeasesSection() {
  const { data, isLoading, isError, refetch } = useMyLeases();
  // Show only active + pending in the rider portal — ended and
  // cancelled lease history is admin-side noise the rider doesn't
  // need to scroll past. If we ever want to surface past leases for
  // riders, gate behind a "Show history" toggle.
  const leases = useMemo(() => {
    if (!data || !data.success) return [];
    return data.data.leases.filter((l) => l.status === 'active' || l.status === 'pending');
  }, [data]);

  if (isLoading) return null;
  // Codex P2 (2026-05-27): error surface so a failed fetch isn't
  // indistinguishable from "no leases" — the previous early-return
  // on empty/error left riders confused why nothing showed.
  if (isError) {
    return (
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Handshake className="text-muted-foreground h-4 w-4" />
          <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
            Leasing
          </h2>
        </div>
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-muted-foreground text-sm">Couldn’t load your leases.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </section>
    );
  }
  if (leases.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Handshake className="text-muted-foreground h-4 w-4" />
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          Leasing
        </h2>
        <Badge variant="secondary">{leases.length}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {leases.map((l) => (
          <LeaseCard key={l.id} lease={l} />
        ))}
      </div>
    </section>
  );
}

function LeaseCard({ lease }: { lease: MyLeaseRow }) {
  const statusClass =
    lease.status === 'active'
      ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
      : 'bg-amber-100 text-amber-800 hover:bg-amber-100';
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex gap-4 p-4">
        <div className="bg-muted relative h-20 w-20 shrink-0 overflow-hidden rounded-lg">
          {lease.horsePhotoUrl ? (
            <Image
              src={lease.horsePhotoUrl}
              alt={lease.horseName}
              fill
              className="object-cover"
              sizes="80px"
            />
          ) : (
            <div className="text-muted-foreground flex h-full w-full items-center justify-center">
              <Rabbit className="h-8 w-8" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-semibold">{lease.horseName}</p>
              <p className="text-muted-foreground text-xs capitalize">
                {lease.leaseType}-lease at {lease.clubName}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {lease.startDate} → {lease.endDate}
              </p>
            </div>
            <Badge variant="secondary" className={statusClass}>
              {lease.status === 'active' ? (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              ) : (
                <Clock className="mr-1 h-3 w-3" />
              )}
              {lease.status === 'active' ? 'Active' : 'Pending'}
            </Badge>
          </div>
          <p className="mt-2 text-xs">
            {formatCurrency(lease.monthlyFeeMinor, lease.currency)} / month
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
