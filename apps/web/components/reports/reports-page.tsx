'use client';

import { useState, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { BarChart3, TrendingUp, Activity, XCircle } from 'lucide-react';
import { formatMoney } from '@equestrian/shared/utils';
import {
  useRevenueReport,
  useLessonPopularityReport,
  useHorseUtilizationReport,
  useCancellationReport,
} from '@/hooks/use-reports';
import { useClubSettings } from '@/hooks/use-settings';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/error-state';

// Audit F-49 (2026-05-07 r4): content-shape skeleton matching the
// label+metric row layout used by Lesson Popularity, Horse Utilization,
// and Revenue by Day cards. Replaces the bare h-32 rectangles that
// caused a visible layout shift when rows landed.
function ReportRowListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

export function ReportsPage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);

  const revenue = useRevenueReport(dateFrom, dateTo);
  const lessons = useLessonPopularityReport(dateFrom, dateTo);
  const horses = useHorseUtilizationReport(dateFrom, dateTo);
  const cancellations = useCancellationReport(dateFrom, dateTo);
  const settingsQuery = useClubSettings();
  // The club's default currency is now only used as a label
  // placeholder during loading or when the period has zero rows in
  // every currency. Each revenue row carries its own currency (audit
  // P1, 2026-05-26), so a settings fetch error no longer corrupts the
  // displayed revenue figure — the per-row currency is always right.
  const currency = settingsQuery.data?.data.currency ?? 'AED';

  // Audit P1 (2026-05-26): revenue rolls up per currency. A club
  // with AED + SAR bookings used to sum the integer minor units
  // together and label them with the club default currency — visibly
  // wrong as soon as both currencies are non-trivial. Group by
  // currency, then render the dominant total in the summary card with
  // a "+N currencies" hint when more than one is present.
  const revenueByCurrency = useMemo(() => {
    const map = new Map<string, number>();
    if (!revenue.data?.data) return map;
    for (const row of revenue.data.data) {
      map.set(row.currency, (map.get(row.currency) ?? 0) + row.revenue);
    }
    return map;
  }, [revenue.data]);

  const sortedRevenueCurrencies = useMemo(
    () => Array.from(revenueByCurrency.entries()).sort(([, a], [, b]) => b - a),
    [revenueByCurrency],
  );

  const totalBookings = useMemo(() => {
    if (!revenue.data?.data) return 0;
    return revenue.data.data.reduce((sum, d) => sum + d.count, 0);
  }, [revenue.data]);

  const cancellationStats = cancellations.data?.data;
  const cancellationRate =
    cancellationStats && cancellationStats.totalBookings > 0
      ? ((cancellationStats.cancelledBookings / cancellationStats.totalBookings) * 100).toFixed(1)
      : '0';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="text-muted-foreground mt-1">Analytics and performance insights</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-40"
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <RevenueSummaryCard
          loading={revenue.isLoading}
          // Surface a settings error too when the rollup would
          // otherwise fall back to the AED label — without this a
          // non-AED club with zero rows in the period sees `AED 0`
          // when their settings query fails. Codex P3 (2026-05-26).
          hasError={
            revenue.isError ||
            (sortedRevenueCurrencies.length === 0 && settingsQuery.isError)
          }
          rollup={sortedRevenueCurrencies}
          fallbackCurrency={currency}
        />
        <SummaryCard
          title="Bookings"
          value={String(totalBookings)}
          icon={BarChart3}
          loading={revenue.isLoading}
          hasError={revenue.isError}
        />
        <SummaryCard
          title="Cancellation Rate"
          value={`${cancellationRate}%`}
          icon={XCircle}
          loading={cancellations.isLoading}
          hasError={cancellations.isError}
        />
        <SummaryCard
          title="No-Shows"
          value={String(cancellationStats?.noShowBookings ?? 0)}
          icon={Activity}
          loading={cancellations.isLoading}
          hasError={cancellations.isError}
        />
      </div>

      {/* Lesson Popularity */}
      <Card>
        <CardHeader>
          <CardTitle>Lesson Popularity</CardTitle>
        </CardHeader>
        <CardContent>
          {lessons.isLoading && <ReportRowListSkeleton />}
          {lessons.isError && (
            <ErrorState message="Failed to load" onRetry={() => lessons.refetch()} />
          )}
          {lessons.data?.data && (
            <div className="space-y-3">
              {lessons.data.data.length === 0 ? (
                <p className="text-muted-foreground text-sm">No bookings in this period.</p>
              ) : (
                lessons.data.data.map((l) => (
                  <div key={l.lessonTypeName} className="flex items-center justify-between">
                    <span className="font-medium">{l.lessonTypeName}</span>
                    <div className="flex items-center gap-2">
                      <div
                        className="bg-primary h-2 rounded-full"
                        style={{ width: `${Math.min(l.count * 4, 200)}px` }}
                      />
                      <Badge variant="outline">{l.count} bookings</Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Horse Utilization */}
      <Card>
        <CardHeader>
          <CardTitle>Horse Utilization</CardTitle>
        </CardHeader>
        <CardContent>
          {horses.isLoading && <ReportRowListSkeleton />}
          {horses.isError && (
            <ErrorState message="Failed to load" onRetry={() => horses.refetch()} />
          )}
          {horses.data?.data && (
            <div className="space-y-3">
              {horses.data.data.length === 0 ? (
                <p className="text-muted-foreground text-sm">No horse data in this period.</p>
              ) : (
                horses.data.data.map((h) => (
                  <div key={h.horseName} className="flex items-center justify-between">
                    <span className="font-medium">{h.horseName}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">
                        {h.bookingCount} lessons (max {h.maxLessonsPerDay}/day)
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue by Day */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue by Day</CardTitle>
        </CardHeader>
        <CardContent>
          {revenue.isLoading && <ReportRowListSkeleton />}
          {revenue.isError && (
            <ErrorState message="Failed to load" onRetry={() => revenue.refetch()} />
          )}
          {revenue.data?.data && (
            <div className="space-y-2">
              {revenue.data.data.length === 0 ? (
                <p className="text-muted-foreground text-sm">No revenue data in this period.</p>
              ) : (
                revenue.data.data.map((d) => (
                  // Key on (date, currency) — a single date can yield
                  // multiple rows when the club bills in more than one
                  // currency. Each row formats with its own currency,
                  // not the club's default.
                  <div
                    key={`${d.date}-${d.currency}`}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">{d.date}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground">{d.count} bookings</span>
                      <span className="font-medium">{formatMoney(d.revenue, d.currency)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Audit P1 (2026-05-26): Revenue summary that respects per-currency
 * bookings. The dominant currency shows in the main metric slot; any
 * additional currencies are listed underneath with their own totals so
 * the operator never sees a mislabeled rollup.
 *
 * `fallbackCurrency` is the club default — used only as a label
 * placeholder during the loading state (where the rollup is empty)
 * and when the period has zero bookings.
 */
function RevenueSummaryCard({
  loading,
  hasError,
  rollup,
  fallbackCurrency,
}: {
  loading: boolean;
  hasError: boolean;
  rollup: ReadonlyArray<[string, number]>;
  fallbackCurrency: string;
}) {
  const [primary, ...rest] = rollup;
  const primaryLabel = primary
    ? formatMoney(primary[1], primary[0])
    : formatMoney(0, fallbackCurrency);

  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-full">
          <TrendingUp className="text-muted-foreground h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">Revenue</p>
          {loading ? (
            <Skeleton className="h-7 w-20" />
          ) : hasError ? (
            <p className="text-destructive text-sm font-medium" title="Failed to load">
              Couldn&apos;t load
            </p>
          ) : (
            <>
              <p className="text-2xl font-bold">{primaryLabel}</p>
              {rest.length > 0 && (
                <div className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                  {rest.map(([cur, amt]) => (
                    <div key={cur}>{formatMoney(amt, cur)}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  loading,
  hasError = false,
}: {
  title: string;
  value: string;
  icon: typeof TrendingUp;
  loading: boolean;
  // Audit F-51 (2026-05-08 r6): when the underlying query errored,
  // render an inline error indicator instead of a legitimate-looking
  // zero. Operators were misreading "0% cancellation" as a clean
  // period when the cancellation query had actually failed.
  hasError?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-full">
          <Icon className="text-muted-foreground h-6 w-6" />
        </div>
        <div>
          <p className="text-muted-foreground text-sm">{title}</p>
          {loading ? (
            <Skeleton className="h-7 w-20" />
          ) : hasError ? (
            <p className="text-destructive text-sm font-medium" title="Failed to load">
              Couldn&apos;t load
            </p>
          ) : (
            <p className="text-2xl font-bold">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
