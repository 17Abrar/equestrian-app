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
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/error-state';

export function ReportsPage() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const thirtyDaysAgo = format(subDays(new Date(), 30), 'yyyy-MM-dd');

  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo);
  const [dateTo, setDateTo] = useState(today);

  const revenue = useRevenueReport(dateFrom, dateTo);
  const lessons = useLessonPopularityReport(dateFrom, dateTo);
  const horses = useHorseUtilizationReport(dateFrom, dateTo);
  const cancellations = useCancellationReport(dateFrom, dateTo);

  const totalRevenue = useMemo(() => {
    if (!revenue.data?.data) return 0;
    return revenue.data.data.reduce((sum, d) => sum + d.revenue, 0);
  }, [revenue.data]);

  const totalBookings = useMemo(() => {
    if (!revenue.data?.data) return 0;
    return revenue.data.data.reduce((sum, d) => sum + d.count, 0);
  }, [revenue.data]);

  const cancellationStats = cancellations.data?.data;
  const cancellationRate = cancellationStats && cancellationStats.totalBookings > 0
    ? ((cancellationStats.cancelledBookings / cancellationStats.totalBookings) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Reports</h1>
          <p className="mt-1 text-muted-foreground">Analytics and performance insights</p>
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
          <span className="text-muted-foreground">to</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryCard
          title="Revenue"
          value={formatMoney(totalRevenue, 'AED')}
          icon={TrendingUp}
          loading={revenue.isLoading}
        />
        <SummaryCard
          title="Bookings"
          value={String(totalBookings)}
          icon={BarChart3}
          loading={revenue.isLoading}
        />
        <SummaryCard
          title="Cancellation Rate"
          value={`${cancellationRate}%`}
          icon={XCircle}
          loading={cancellations.isLoading}
        />
        <SummaryCard
          title="No-Shows"
          value={String(cancellationStats?.noShowBookings ?? 0)}
          icon={Activity}
          loading={cancellations.isLoading}
        />
      </div>

      {/* Lesson Popularity */}
      <Card>
        <CardHeader><CardTitle>Lesson Popularity</CardTitle></CardHeader>
        <CardContent>
          {lessons.isLoading && <Skeleton className="h-32" />}
          {lessons.isError && <ErrorState message="Failed to load" onRetry={() => lessons.refetch()} />}
          {lessons.data?.data && (
            <div className="space-y-3">
              {lessons.data.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bookings in this period.</p>
              ) : (
                lessons.data.data.map((l) => (
                  <div key={l.lessonTypeName} className="flex items-center justify-between">
                    <span className="font-medium">{l.lessonTypeName}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-2 rounded-full bg-primary" style={{ width: `${Math.min(l.count * 4, 200)}px` }} />
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
        <CardHeader><CardTitle>Horse Utilization</CardTitle></CardHeader>
        <CardContent>
          {horses.isLoading && <Skeleton className="h-32" />}
          {horses.isError && <ErrorState message="Failed to load" onRetry={() => horses.refetch()} />}
          {horses.data?.data && (
            <div className="space-y-3">
              {horses.data.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">No horse data in this period.</p>
              ) : (
                horses.data.data.map((h) => (
                  <div key={h.horseName} className="flex items-center justify-between">
                    <span className="font-medium">{h.horseName}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
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
        <CardHeader><CardTitle>Revenue by Day</CardTitle></CardHeader>
        <CardContent>
          {revenue.isLoading && <Skeleton className="h-32" />}
          {revenue.isError && <ErrorState message="Failed to load" onRetry={() => revenue.refetch()} />}
          {revenue.data?.data && (
            <div className="space-y-2">
              {revenue.data.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">No revenue data in this period.</p>
              ) : (
                revenue.data.data.map((d) => (
                  <div key={d.date} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{d.date}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground">{d.count} bookings</span>
                      <span className="font-medium">{formatMoney(d.revenue, 'AED')}</span>
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

function SummaryCard({ title, value, icon: Icon, loading }: { title: string; value: string; icon: typeof TrendingUp; loading: boolean }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          {loading ? <Skeleton className="h-7 w-20" /> : <p className="text-2xl font-bold">{value}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
