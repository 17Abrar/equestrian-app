'use client';

import Link from 'next/link';
import { PawPrint, Users, Calendar, Clock, BookOpen } from 'lucide-react';
import { useDashboardStats } from '@/hooks/use-dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';

import { BOOKING_STATUS_COLORS } from '@/lib/ui-constants';

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  href,
  emptyCta,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: typeof PawPrint;
  href: string;
  /**
   * Audit P2 (2026-05-28): when value is 0/'0', show this CTA instead
   * of the numeric value so a brand-new club sees an actionable
   * prompt rather than four blank "0" cards on first load. Keeps the
   * card clickable to the same href.
   */
  emptyCta?: string;
}) {
  const isEmpty =
    emptyCta !== undefined &&
    (value === 0 || value === '0');
  return (
    <Link href={href}>
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="flex items-center gap-4 p-6">
          <div className="bg-primary/10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg">
            <Icon className="text-primary h-6 w-6" />
          </div>
          <div>
            <p className="text-muted-foreground text-sm">{title}</p>
            {isEmpty ? (
              <p className="text-primary text-sm font-medium underline-offset-2 group-hover:underline">
                {emptyCta} →
              </p>
            ) : (
              <p className="text-2xl font-bold">{value}</p>
            )}
            {subtitle && !isEmpty && (
              <p className="text-muted-foreground text-xs">{subtitle}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-9 w-48" />
        <Skeleton className="mt-1 h-5 w-80" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center gap-4 p-6">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <div>
                <Skeleton className="mb-1 h-4 w-20" />
                <Skeleton className="h-8 w-12" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="p-6">
          <Skeleton className="mb-4 h-6 w-40" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="mb-3 h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export function DashboardOverview() {
  const { data, isLoading, isError, error, refetch } = useDashboardStats();

  if (isLoading) return <DashboardSkeleton />;
  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load dashboard'}
        onRetry={() => refetch()}
      />
    );
  }

  const stats = data?.data;
  if (!stats) return <ErrorState message="No data available" />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          Welcome to your equestrian club management dashboard.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Today's Bookings"
          value={stats.todayBookings.total}
          subtitle={`${stats.todayBookings.confirmed} confirmed, ${stats.todayBookings.pending} pending`}
          icon={BookOpen}
          href="/bookings"
          emptyCta="Add a booking"
        />
        <StatCard
          title="Today's Slots"
          value={stats.todaySlots}
          subtitle="Scheduled lessons"
          icon={Calendar}
          href="/calendar"
          emptyCta="Open the calendar"
        />
        <StatCard
          title="Horses"
          value={stats.horses.total}
          subtitle={`${stats.horses.available} available`}
          icon={PawPrint}
          href="/horses"
          emptyCta="Add your first horse"
        />
        <StatCard
          title="Riders"
          value={stats.riders.total}
          subtitle="Active riders"
          icon={Users}
          href="/riders"
          emptyCta="Add your first rider"
        />
      </div>

      {/* Recent Bookings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Recent Bookings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recentBookings.length === 0 ? (
            <EmptyState
              title="No bookings yet"
              description="Schedule your first lesson to see it here."
              action={{ label: 'Open calendar', href: '/calendar' }}
            />
          ) : (
            <div className="space-y-3">
              {stats.recentBookings.map((booking) => (
                <div
                  key={booking.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">{booking.riderName ?? 'Unknown Rider'}</p>
                    <p className="text-muted-foreground text-sm">
                      {booking.slotDate} at {booking.slotStartTime}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={BOOKING_STATUS_COLORS[booking.status] ?? ''}
                  >
                    {booking.status.replace('_', ' ')}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
