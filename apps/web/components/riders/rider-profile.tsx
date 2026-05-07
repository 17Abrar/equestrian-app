'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Edit, Save, X, Calendar, Clock, MapPin, TrendingUp } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { updateRiderProfileSchema, type UpdateRiderProfileFormValues, type UpdateRiderProfileInput } from '@equestrian/shared/schemas';
import { useRider, useUpdateRider } from '@/hooks/use-riders';
import { useBookings, type Booking } from '@/hooks/use-bookings';
import { formatMoney } from '@equestrian/shared/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
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
import { ErrorState } from '@/components/shared/error-state';
import { reportMutationError } from '@/components/shared/report-mutation-error';

import { SKILL_LEVEL_COLORS } from '@/lib/ui-constants';
import { MAX_PAGE_SIZE } from '@equestrian/shared/constants';

interface RiderProfileProps {
  riderId: string;
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="p-6">
            <Skeleton className="mx-auto mb-4 h-24 w-24 rounded-full" />
            <Skeleton className="mx-auto mb-2 h-6 w-3/4" />
            <Skeleton className="mx-auto h-4 w-1/2" />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardContent className="p-6">
            <Skeleton className="mb-4 h-10 w-full" />
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

export function RiderProfile({ riderId }: RiderProfileProps) {
  const { data, isLoading, isError, error, refetch } = useRider(riderId);
  const updateRider = useUpdateRider(riderId);
  const [isEditing, setIsEditing] = useState(false);

  // fetchJson throws on non-2xx; the single `data.success` check is the
  // minimal guard TypeScript needs to narrow the union — see audit E-5.
  const rider = data?.success ? data.data : null;

  const form = useForm<UpdateRiderProfileFormValues, unknown, UpdateRiderProfileInput>({
    resolver: zodResolver(updateRiderProfileSchema),
    values: rider
      ? {
          dateOfBirth: rider.dateOfBirth ?? undefined,
          weightKg: rider.weightKg ? Number(rider.weightKg) : undefined,
          heightCm: rider.heightCm ? Number(rider.heightCm) : undefined,
          skillLevel: rider.skillLevel as 'beginner' | 'intermediate' | 'advanced',
          emergencyContactName: rider.emergencyContactName ?? undefined,
          emergencyContactPhone: rider.emergencyContactPhone ?? undefined,
          emergencyContactRelation: rider.emergencyContactRelation ?? undefined,
          medicalNotes: rider.medicalNotes ?? undefined,
        }
      : undefined,
  });

  if (isLoading) return <ProfileSkeleton />;
  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load rider'}
        onRetry={() => refetch()}
      />
    );
  }

  if (!rider) {
    return <ErrorState message="Rider not found" />;
  }

  async function onSubmit(data: UpdateRiderProfileInput) {
    try {
      await updateRider.mutateAsync(data);
      toast.success('Rider profile updated');
      setIsEditing(false);
    } catch (submitError) {
      reportMutationError('rider.update_profile', submitError);
      toast.error(submitError instanceof Error ? submitError.message : 'Failed to update rider');
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild aria-label="Back to riders">
            <Link href="/riders">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {rider.displayName ?? 'Unnamed Rider'}
            </h1>
            {rider.email && (
              <p className="text-muted-foreground">{rider.email}</p>
            )}
          </div>
          <Badge className={SKILL_LEVEL_COLORS[rider.skillLevel] ?? ''}>
            {rider.skillLevel}
          </Badge>
        </div>
        <div className="flex gap-2">
          {isEditing ? (
            <>
              <Button
                size="sm"
                onClick={form.handleSubmit(onSubmit)}
                disabled={updateRider.isPending}
              >
                <Save className="mr-2 h-4 w-4" />
                {updateRider.isPending ? 'Saving...' : 'Save'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsEditing(false);
                  form.reset();
                }}
              >
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              <Edit className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sidebar */}
        <Card className="lg:col-span-1">
          <CardContent className="p-6">
            <div className="mb-4 flex h-24 w-24 mx-auto items-center justify-center rounded-full bg-muted text-3xl">
              {(rider.displayName ?? 'R').charAt(0).toUpperCase()}
            </div>
            <div className="space-y-3 text-center">
              <h2 className="text-lg font-semibold">{rider.displayName ?? 'Unnamed Rider'}</h2>
              {rider.phone && <p className="text-sm text-muted-foreground">{rider.phone}</p>}
            </div>
            <div className="mt-6 space-y-3">
              <DetailRow label="Skill Level" value={rider.skillLevel} />
              <DetailRow label="Weight" value={rider.weightKg ? `${rider.weightKg} kg` : null} />
              <DetailRow label="Height" value={rider.heightCm ? `${rider.heightCm} cm` : null} />
              <DetailRow label="Total Lessons" value={rider.totalLessonsCompleted} />
              <DetailRow label="Date of Birth" value={rider.dateOfBirth} />
            </div>
          </CardContent>
        </Card>

        {/* Main Content */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="bookings">Bookings</TabsTrigger>
              <TabsTrigger value="progress">Progress</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-4">
              {isEditing ? (
                <Form {...form}>
                  <form className="space-y-4">
                    <Card>
                      <CardHeader>
                        <CardTitle>Personal Details</CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="dateOfBirth"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Date of Birth</FormLabel>
                              <FormControl>
                                <Input type="date" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="weightKg"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Weight (kg)</FormLabel>
                              <FormControl>
                                <NumberInput step="0.1" placeholder="e.g. 65" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="heightCm"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Height (cm)</FormLabel>
                              <FormControl>
                                <NumberInput step="0.1" placeholder="e.g. 170" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="skillLevel"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Skill Level</FormLabel>
                              <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="beginner">Beginner</SelectItem>
                                  <SelectItem value="intermediate">Intermediate</SelectItem>
                                  <SelectItem value="advanced">Advanced</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Emergency Contact</CardTitle>
                      </CardHeader>
                      <CardContent className="grid gap-4 sm:grid-cols-2">
                        <FormField
                          control={form.control}
                          name="emergencyContactName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Name</FormLabel>
                              <FormControl>
                                <Input placeholder="Contact name" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="emergencyContactPhone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Phone</FormLabel>
                              <FormControl>
                                <Input placeholder="Contact phone" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="emergencyContactRelation"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Relationship</FormLabel>
                              <FormControl>
                                <Input placeholder="e.g. Parent, Spouse" {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle>Medical Notes</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <FormField
                          control={form.control}
                          name="medicalNotes"
                          render={({ field }) => (
                            <FormItem>
                              <FormControl>
                                <Textarea
                                  placeholder="Allergies, conditions, or other medical info..."
                                  rows={4}
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </CardContent>
                    </Card>
                  </form>
                </Form>
              ) : (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Emergency Contact</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4 sm:grid-cols-2">
                      <DetailRow label="Name" value={rider.emergencyContactName} />
                      <DetailRow label="Phone" value={rider.emergencyContactPhone} />
                      <DetailRow label="Relationship" value={rider.emergencyContactRelation} />
                      {!rider.emergencyContactName && !rider.emergencyContactPhone && (
                        <p className="text-sm text-muted-foreground sm:col-span-2">
                          No emergency contact on file
                        </p>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle>Medical Notes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {rider.medicalNotes ? (
                        <p className="whitespace-pre-wrap">{rider.medicalNotes}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">No medical notes</p>
                      )}
                    </CardContent>
                  </Card>
                </>
              )}
            </TabsContent>

            <TabsContent value="bookings" className="mt-4">
              <RiderBookings riderMemberId={rider.id} />
            </TabsContent>

            <TabsContent value="progress" className="mt-4">
              <RiderProgress
                riderMemberId={rider.id}
                totalLessonsCompleted={rider.totalLessonsCompleted ?? 0}
                skillLevel={rider.skillLevel}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// ─── Bookings tab ─────────────────────────────────────────────────────

function RiderBookings({ riderMemberId }: { riderMemberId: string }) {
  const { data, isLoading, isError, error, refetch } = useBookings({
    riderMemberId,
    pageSize: 50,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load bookings'}
        onRetry={refetch}
      />
    );
  }

  const bookings = data?.data ?? [];
  if (bookings.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-sm text-muted-foreground">No bookings yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Bookings this rider makes will show up here.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Upcoming are on or after today's date (string compare is safe because the
  // API returns ISO YYYY-MM-DD). Past includes cancelled + no-show so admins
  // can see the whole history at a glance.
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = bookings.filter((b) => b.slotDate >= today && b.status !== 'cancelled');
  const past = bookings.filter((b) => !upcoming.includes(b));

  return (
    <div className="space-y-6">
      {upcoming.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Upcoming ({upcoming.length})</h3>
          <div className="space-y-2">
            {upcoming.map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
          </div>
        </section>
      )}
      {past.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Past ({past.length})</h3>
          <div className="space-y-2">
            {past.map((b) => (
              <BookingRow key={b.id} booking={b} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  const statusTone =
    booking.status === 'completed'
      ? 'bg-green-100 text-green-800'
      : booking.status === 'cancelled'
        ? 'bg-muted text-muted-foreground'
        : booking.status === 'no_show'
          ? 'bg-red-100 text-red-800'
          : 'bg-blue-100 text-blue-800';

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{booking.lessonTypeName}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {booking.slotDate}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {booking.slotStartTime} – {booking.slotEndTime}
            </span>
            {booking.arenaName && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {booking.arenaName}
              </span>
            )}
            {booking.horseName && <span>Horse: {booking.horseName}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          {booking.amount != null && (
            <span className="text-sm font-semibold">
              {formatMoney(booking.amount, booking.currency)}
            </span>
          )}
          <Badge variant="secondary" className={`text-xs ${statusTone}`}>
            {booking.status.replace('_', ' ')}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Progress tab ─────────────────────────────────────────────────────

interface ProgressProps {
  riderMemberId: string;
  totalLessonsCompleted: number;
  skillLevel: string;
}

function RiderProgress({ riderMemberId, totalLessonsCompleted, skillLevel }: ProgressProps) {
  // Fetch the rider's bookings (completed only) so we can break down lessons
  // by month for a simple activity view.
  const { data, isLoading, isError } = useBookings({
    riderMemberId,
    status: 'completed',
    pageSize: MAX_PAGE_SIZE,
  });

  const bookings = data?.data ?? [];

  // Build a YYYY-MM → count map from completed bookings.
  const byMonth = new Map<string, number>();
  for (const b of bookings) {
    const key = b.slotDate.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }
  const recentMonths = Array.from(byMonth.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .reverse();
  const maxCount = Math.max(1, ...recentMonths.map(([, n]) => n));

  // Unique horse + lesson-type counts
  const uniqueHorses = new Set(bookings.filter((b) => b.horseName).map((b) => b.horseName));
  const uniqueLessonTypes = new Set(bookings.map((b) => b.lessonTypeName));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Lessons completed" value={totalLessonsCompleted} />
        <StatCard label="Horses ridden" value={uniqueHorses.size} />
        <StatCard label="Lesson types" value={uniqueLessonTypes.size} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4" />
            Activity (last 6 months)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : isError ? (
            <p className="text-sm text-muted-foreground">Couldn&apos;t load activity.</p>
          ) : recentMonths.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No completed lessons yet. Activity will show once the rider finishes lessons.
            </p>
          ) : (
            <div className="flex items-end gap-3">
              {recentMonths.map(([month, count]) => (
                <div key={month} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex h-32 w-full items-end">
                    <div
                      className="w-full rounded-t-sm bg-primary/80"
                      style={{ height: `${(count / maxCount) * 100}%` }}
                      aria-label={`${count} lessons in ${month}`}
                    />
                  </div>
                  <p className="text-xs font-medium">{count}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {month.slice(5)}/{month.slice(2, 4)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Skill progression</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Current level</span>
            <Badge className={SKILL_LEVEL_COLORS[skillLevel] ?? ''}>{skillLevel}</Badge>
          </div>
          <SkillLadder current={skillLevel} />
          <p className="text-xs text-muted-foreground">
            Staff can update skill level from the Overview tab after observing the rider.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function SkillLadder({ current }: { current: string }) {
  const levels: Array<'beginner' | 'intermediate' | 'advanced'> = [
    'beginner',
    'intermediate',
    'advanced',
  ];
  const currentIndex = levels.indexOf(current as 'beginner' | 'intermediate' | 'advanced');
  return (
    <div className="flex items-center gap-1">
      {levels.map((level, idx) => {
        const active = idx <= currentIndex;
        return (
          <div key={level} className="flex flex-1 flex-col items-center gap-1">
            <div
              className={`h-1.5 w-full rounded ${active ? 'bg-primary' : 'bg-muted'}`}
            />
            <span
              className={`text-[10px] uppercase tracking-wider ${active ? 'font-semibold' : 'text-muted-foreground'}`}
            >
              {level}
            </span>
          </div>
        );
      })}
    </div>
  );
}
