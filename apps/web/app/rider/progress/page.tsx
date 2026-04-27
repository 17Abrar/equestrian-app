'use client';

import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Award, BookOpen, Target } from 'lucide-react';
import { useBookings } from '@/hooks/use-bookings';
import { fetchJson } from '@/lib/fetch-json';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/error-state';
import { EmptyState } from '@/components/shared/empty-state';
import { SKILL_LEVEL_COLORS } from '@/lib/ui-constants';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { formatTime } from '@equestrian/shared/utils';
import { STALE_TIME_STABLE } from '@equestrian/shared/constants';

interface RiderProfile {
  id: string;
  clubId: string;
  memberId: string;
  dateOfBirth: string | null;
  weightKg: string | null;
  heightCm: string | null;
  skillLevel: string;
  totalLessonsCompleted: number;
  parentMemberId: string | null;
  displayName: string | null;
}

// Audit E-7: use the shared fetchJson helper rather than re-implementing
// the throw-on-non-2xx + error-message-extraction shape.
function useRiderProfile() {
  return useQuery({
    queryKey: ['me', 'profile'],
    queryFn: () => fetchJson<ApiSuccessResponse<RiderProfile | null>>('/api/v1/me/profile'),
    staleTime: STALE_TIME_STABLE,
  });
}

function StatCard({ icon: Icon, label, value }: { icon: typeof TrendingUp; label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function RiderProgressPage() {
  const { data: profileData, isLoading: profileLoading, isError: profileError, error: profileErr, refetch: refetchProfile } = useRiderProfile();
  const { data: completedData, isLoading: completedLoading, isError: completedError, error: completedErr, refetch: refetchCompleted } = useBookings({ status: 'completed', pageSize: 10 });
  const { data: upcomingData } = useBookings({ status: 'confirmed', pageSize: 1 });
  // PaginatedResponse<T>.pagination is non-optional once `data` is loaded —
  // the extra `?.` was defensive theater (audit E-9). The first `?.` covers
  // the initial-loading undefined case; nothing past that.
  const upcomingCount = upcomingData?.pagination.total ?? 0;

  const profile = profileData?.data;
  const completedBookings = completedData?.data ?? [];

  if (profileLoading) return <ProgressSkeleton />;
  if (profileError) return <ErrorState message={profileErr?.message} onRetry={refetchProfile} />;

  if (!profile) {
    return (
      <EmptyState
        title="No rider profile yet"
        description="Your profile will be set up when you're registered by the club."
      />
    );
  }

  return (
    <div className="space-y-8 pb-20 sm:pb-0">
      <div>
        <h1 className="text-2xl font-bold">My Progress</h1>
        <p className="text-muted-foreground">Track your riding journey</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={BookOpen} label="Lessons Completed" value={profile.totalLessonsCompleted} />
        <StatCard
          icon={Target}
          label="Skill Level"
          value={profile.skillLevel.charAt(0).toUpperCase() + profile.skillLevel.slice(1)}
        />
        <StatCard
          icon={Award}
          label="Upcoming"
          value={upcomingCount}
        />
        <StatCard
          icon={TrendingUp}
          label="This Month"
          value={completedBookings.filter(
            (b) => b.slotDate.startsWith(new Date().toISOString().slice(0, 7)),
          ).length}
        />
      </div>

      {/* Skill badge */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Current Level</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Badge className={SKILL_LEVEL_COLORS[profile.skillLevel] ?? ''} variant="secondary">
              {profile.skillLevel}
            </Badge>
            <p className="text-sm text-muted-foreground">
              {profile.skillLevel === 'beginner' && 'You\'re building a solid foundation. Keep going!'}
              {profile.skillLevel === 'intermediate' && 'Great progress! You\'re developing strong riding skills.'}
              {profile.skillLevel === 'advanced' && 'Excellent! You\'ve mastered advanced riding techniques.'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Recent completed lessons */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Recent Lessons</h2>
        {completedLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : completedError ? (
          <ErrorState message={completedErr?.message} onRetry={refetchCompleted} />
        ) : completedBookings.length === 0 ? (
          <EmptyState
            title="No completed lessons yet"
            description="Book your first lesson to start tracking progress."
            action={{ label: 'Book a Lesson', href: '/rider/book' }}
          />
        ) : (
          <div className="space-y-2">
            {completedBookings.map((booking) => (
              <Card key={booking.id}>
                <CardContent className="flex items-center justify-between p-3">
                  <div>
                    <p className="text-sm font-medium">{booking.lessonTypeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(`${booking.slotDate}T00:00:00`).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      })} at {formatTime(booking.slotStartTime)}
                    </p>
                  </div>
                  {booking.horseName && (
                    <span className="text-xs text-muted-foreground">{booking.horseName}</span>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
