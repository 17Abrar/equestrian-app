'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { type z } from 'zod';
import { updateClubProfileSchema, updateBookingRulesSchema, type UpdateClubProfileInput, type UpdateBookingRulesInput } from '@equestrian/shared/schemas';
import { useClubSettings, useUpdateSettings, type ClubSettings } from '@/hooks/use-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileUpload } from '@/components/ui/file-upload';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorState } from '@/components/shared/error-state';

function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-96" />
    </div>
  );
}

export function SettingsPage() {
  const { data, isLoading, isError, error, refetch } = useClubSettings();

  if (isLoading) return <SettingsSkeleton />;
  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load settings'}
        onRetry={() => refetch()}
      />
    );
  }

  const settings = data?.data;
  if (!settings) return <ErrorState message="Club not found" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-muted-foreground">Configure your club preferences</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Club Profile</TabsTrigger>
          <TabsTrigger value="booking">Booking Rules</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="payment">Payment</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <ClubProfileForm settings={settings} />
        </TabsContent>

        <TabsContent value="booking" className="mt-6">
          <BookingRulesForm settings={settings} />
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <PlaceholderTab title="Notification Templates" description="Configure email and push notification templates for booking confirmations, reminders, and alerts." />
        </TabsContent>

        <TabsContent value="permissions" className="mt-6">
          <PlaceholderTab title="Staff Permissions" description="View and customize role-based access control for your staff members." />
        </TabsContent>

        <TabsContent value="payment" className="mt-6">
          <PlaceholderTab title="Payment Configuration" description="Connect Stripe, configure payment methods, and manage your payment settings." />
        </TabsContent>

        <TabsContent value="branding" className="mt-6">
          <PlaceholderTab title="Branding" description="Customize your club's appearance with custom colors, logos, and white-label options." />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PlaceholderTab({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">This feature is coming soon.</p>
      </CardContent>
    </Card>
  );
}

function ClubProfileForm({ settings }: { settings: ClubSettings }) {
  const updateSettings = useUpdateSettings();

  const form = useForm<UpdateClubProfileInput>({
    resolver: zodResolver(updateClubProfileSchema),
    defaultValues: {
      name: settings.name ?? '',
      email: settings.email ?? '',
      phone: settings.phone ?? '',
      address: settings.address ?? '',
      city: settings.city ?? '',
      country: settings.country ?? '',
      timezone: settings.timezone ?? 'Asia/Dubai',
      currency: settings.currency ?? 'AED',
      logoUrl: settings.logoUrl ?? '',
      websiteUrl: settings.websiteUrl ?? '',
      socialInstagram: settings.socialInstagram ?? '',
      socialFacebook: settings.socialFacebook ?? '',
      socialTiktok: settings.socialTiktok ?? '',
      description: settings.description ?? '',
    },
  });

  async function onSubmit(data: UpdateClubProfileInput) {
    try {
      await updateSettings.mutateAsync(data);
      toast.success('Club profile updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Club Profile</CardTitle>
        <CardDescription>Basic information about your club</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Club Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem><FormLabel>Phone</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem><FormLabel>City</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="country" render={({ field }) => (
                <FormItem><FormLabel>Country</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="timezone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Timezone</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? 'Asia/Dubai'}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="Asia/Dubai">Asia/Dubai (UTC+4)</SelectItem>
                      <SelectItem value="Asia/Riyadh">Asia/Riyadh (UTC+3)</SelectItem>
                      <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                      <SelectItem value="America/New_York">America/New York (EST)</SelectItem>
                      <SelectItem value="America/Los_Angeles">America/Los Angeles (PST)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="currency" render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? 'AED'}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="AED">AED (UAE Dirham)</SelectItem>
                      <SelectItem value="SAR">SAR (Saudi Riyal)</SelectItem>
                      <SelectItem value="USD">USD (US Dollar)</SelectItem>
                      <SelectItem value="GBP">GBP (British Pound)</SelectItem>
                      <SelectItem value="EUR">EUR (Euro)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="address" render={({ field }) => (
              <FormItem><FormLabel>Address</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={3} placeholder="Tell riders about your club..." {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="websiteUrl" render={({ field }) => (
                <FormItem><FormLabel>Website</FormLabel><FormControl><Input type="url" placeholder="https://..." {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="logoUrl" render={({ field }) => (
                <FormItem>
                  <FormLabel>Logo</FormLabel>
                  <FormControl>
                    <FileUpload
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      folder="club/logo"
                      accept="image/*"
                      preview
                      label="Drop club logo here"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="socialInstagram" render={({ field }) => (
                <FormItem><FormLabel>Instagram</FormLabel><FormControl><Input placeholder="@yourclub" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="socialFacebook" render={({ field }) => (
                <FormItem><FormLabel>Facebook</FormLabel><FormControl><Input placeholder="facebook.com/yourclub" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <Button type="submit" disabled={updateSettings.isPending}>
              {updateSettings.isPending ? 'Saving...' : 'Save Profile'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function BookingRulesForm({ settings }: { settings: ClubSettings }) {
  const updateSettings = useUpdateSettings();

  type BookingRulesFormValues = z.input<typeof updateBookingRulesSchema>;
  const form = useForm<BookingRulesFormValues, unknown, UpdateBookingRulesInput>({
    resolver: zodResolver(updateBookingRulesSchema),
    defaultValues: {
      advanceBookingDays: settings.advanceBookingDays ?? 30,
      bookingCutoffHours: settings.bookingCutoffHours ?? 2,
      cancellationNoticeHours: settings.cancellationNoticeHours ?? 24,
      defaultLessonDurationMinutes: settings.defaultLessonDurationMinutes ?? 60,
      allowOverbooking: settings.allowOverbooking ?? false,
      overbookingLimit: settings.overbookingLimit ?? 0,
      defaultCalendarView: (settings.defaultCalendarView as 'day' | 'week' | 'month' | 'agenda') ?? 'week',
    },
  });

  async function onSubmit(data: UpdateBookingRulesInput) {
    try {
      await updateSettings.mutateAsync(data);
      toast.success('Booking rules updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update booking rules');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Booking Rules</CardTitle>
        <CardDescription>Control how riders book lessons at your club</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="advanceBookingDays" render={({ field }) => (
                <FormItem>
                  <FormLabel>Advance Booking Window (days)</FormLabel>
                  <FormControl><Input type="number" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl>
                  <FormDescription>How far in advance riders can book</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="bookingCutoffHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Booking Cutoff (hours)</FormLabel>
                  <FormControl><Input type="number" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl>
                  <FormDescription>Minimum hours before lesson start to book</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="cancellationNoticeHours" render={({ field }) => (
                <FormItem>
                  <FormLabel>Cancellation Notice (hours)</FormLabel>
                  <FormControl><Input type="number" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl>
                  <FormDescription>Hours before lesson to cancel without penalty</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="defaultLessonDurationMinutes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Lesson Duration (min)</FormLabel>
                  <FormControl><Input type="number" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="defaultCalendarView" render={({ field }) => (
              <FormItem>
                <FormLabel>Default Calendar View</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? 'week'}>
                  <FormControl><SelectTrigger className="w-48"><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="day">Day</SelectItem>
                    <SelectItem value="week">Week</SelectItem>
                    <SelectItem value="month">Month</SelectItem>
                    <SelectItem value="agenda">Agenda</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="flex items-center gap-4">
              <FormField control={form.control} name="allowOverbooking" render={({ field }) => (
                <FormItem className="flex items-center gap-2">
                  <FormLabel>Allow Overbooking</FormLabel>
                  <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                </FormItem>
              )} />
              {form.watch('allowOverbooking') && (
                <FormField control={form.control} name="overbookingLimit" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Overbooking Limit</FormLabel>
                    <FormControl><Input type="number" className="w-20" {...field} value={(field.value as number | undefined) ?? ''} /></FormControl>
                  </FormItem>
                )} />
              )}
            </div>
            <Button type="submit" disabled={updateSettings.isPending}>
              {updateSettings.isPending ? 'Saving...' : 'Save Booking Rules'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
