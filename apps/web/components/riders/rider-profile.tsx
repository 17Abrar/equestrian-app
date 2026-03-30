'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Edit, Save, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { updateRiderProfileSchema, type UpdateRiderProfileFormValues, type UpdateRiderProfileInput } from '@equestrian/shared/schemas';
import { useRider, useUpdateRider, type Rider } from '@/hooks/use-riders';
import { type ApiSuccessResponse } from '@equestrian/shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

import { SKILL_LEVEL_COLORS } from '@/lib/ui-constants';

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

  const rider = data && 'data' in data && data.success ? (data as ApiSuccessResponse<Rider>).data : null;

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
                                <Input type="number" step="0.1" placeholder="e.g. 65" {...field} value={(field.value as number | undefined) ?? ''} />
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
                                <Input type="number" step="0.1" placeholder="e.g. 170" {...field} value={(field.value as number | undefined) ?? ''} />
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
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <p className="text-muted-foreground">Booking history coming soon</p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="progress" className="mt-4">
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-16">
                  <p className="text-muted-foreground">Progress tracking coming soon</p>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
