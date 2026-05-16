'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { type z } from 'zod';
import {
  updateClubProfileSchema,
  updateBookingRulesSchema,
  type UpdateClubProfileInput,
  type UpdateBookingRulesInput,
} from '@equestrian/shared/schemas';
import { useClubSettings, useUpdateSettings, type ClubSettings } from '@/hooks/use-settings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
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
import { reportMutationError } from '@/components/shared/report-mutation-error';
import { PaymentsPanel } from '@/components/payments/payments-panel';
import { NotificationsForm } from '@/components/settings/notifications-form';
import { PermissionsMatrix } from '@/components/settings/permissions-matrix';
import { BrandingForm } from '@/components/settings/branding-form';
import { DiscoveryForm } from '@/components/settings/discovery-form';
import { SubscriptionPanel } from '@/components/settings/subscription-panel';

// Audit F-51 (2026-05-07 r4): content-shape skeleton mirroring the title +
// 8-tab TabsList + form-card layout used by the Settings page. Replaces
// the single h-96 rectangle that didn't match the rendered shape.
function SettingsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Title */}
      <Skeleton className="h-8 w-48" />
      {/* TabsList — 8 tabs in one row */}
      <div className="flex gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-24" />
        ))}
      </div>
      {/* Form card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="mt-2 h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </CardContent>
      </Card>
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
        <p className="text-muted-foreground mt-1">Configure your club preferences</p>
      </div>

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Club Profile</TabsTrigger>
          <TabsTrigger value="booking">Booking Rules</TabsTrigger>
          <TabsTrigger value="discovery">Discovery</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="permissions">Permissions</TabsTrigger>
          <TabsTrigger value="payment">Payment</TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <ClubProfileForm settings={settings} />
        </TabsContent>

        <TabsContent value="booking" className="mt-6">
          <BookingRulesForm settings={settings} />
        </TabsContent>

        <TabsContent value="discovery" className="mt-6">
          <DiscoveryForm settings={settings} />
        </TabsContent>

        <TabsContent value="notifications" className="mt-6">
          <NotificationsForm settings={settings} />
        </TabsContent>

        <TabsContent value="permissions" className="mt-6">
          <PermissionsMatrix />
        </TabsContent>

        <TabsContent value="payment" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Payment Providers</CardTitle>
              <CardDescription>
                Connect a payment processor so riders can pay for lessons online. Only one provider
                can be active at a time — the active one is used for all new bookings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PaymentsPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subscription" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Cavaliq Subscription</CardTitle>
              <CardDescription>
                Your monthly Cavaliq subscription. Invoices are issued automatically — pay them via
                the Ziina link to keep your account active.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SubscriptionPanel />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="mt-6">
          <BrandingForm settings={settings} />
        </TabsContent>
      </Tabs>
    </div>
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
      // Audit 2026-05-13: API response types currency as `string`; cast to
      // the narrowed SupportedCurrency union the form expects. The server
      // already enforced the enum at write time.
      currency: (settings.currency ?? 'AED') as
        | 'AED'
        | 'SAR'
        | 'KWD'
        | 'BHD'
        | 'QAR'
        | 'OMR'
        | 'USD'
        | 'EUR'
        | 'GBP'
        | 'CAD'
        | 'AUD',
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
      reportMutationError('settings.profile.update', err);
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
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Club Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="timezone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Timezone</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? 'Asia/Dubai'}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Asia/Dubai">Asia/Dubai (UTC+4)</SelectItem>
                        <SelectItem value="Asia/Riyadh">Asia/Riyadh (UTC+3)</SelectItem>
                        <SelectItem value="Europe/London">Europe/London (GMT)</SelectItem>
                        <SelectItem value="America/New_York">America/New York (EST)</SelectItem>
                        <SelectItem value="America/Los_Angeles">
                          America/Los Angeles (PST)
                        </SelectItem>
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
                    <FormLabel>Currency</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value ?? 'AED'}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
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
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={3} placeholder="Tell riders about your club..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="websiteUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website</FormLabel>
                    <FormControl>
                      <Input type="url" placeholder="https://..." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="logoUrl"
                render={({ field }) => (
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
                )}
              />
              <FormField
                control={form.control}
                name="socialInstagram"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Instagram</FormLabel>
                    <FormControl>
                      <Input placeholder="@yourclub" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="socialFacebook"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Facebook</FormLabel>
                    <FormControl>
                      <Input placeholder="facebook.com/yourclub" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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

// Audit F-57 (2026-05-07 r5 PR Sigma): the previous
// `settings.defaultCalendarView as 'day' | 'week' | 'month' | 'agenda'` cast
// trusted whatever value the API returned without runtime verification.
// Declare the literal tuple, derive the type, and runtime-check the API
// value at the boundary — mirrors `BOOKING_STATUS_FILTER_VALUES.includes(...)`
// in bookings-list.tsx.
const CALENDAR_VIEW_VALUES = ['day', 'week', 'month', 'agenda'] as const;
type CalendarView = (typeof CALENDAR_VIEW_VALUES)[number];

function isCalendarView(v: string | null | undefined): v is CalendarView {
  return typeof v === 'string' && CALENDAR_VIEW_VALUES.includes(v as CalendarView);
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
      bookingPaymentTimeoutMinutes: settings.bookingPaymentTimeoutMinutes ?? 15,
      defaultLessonDurationMinutes: settings.defaultLessonDurationMinutes ?? 60,
      allowOverbooking: settings.allowOverbooking ?? false,
      overbookingLimit: settings.overbookingLimit ?? 0,
      defaultCalendarView: isCalendarView(settings.defaultCalendarView)
        ? settings.defaultCalendarView
        : 'week',
      lateCancellationFeePercent: Number(settings.lateCancellationFeePercent ?? '0'),
      noShowFeePercent: Number(settings.noShowFeePercent ?? '0'),
    },
  });

  async function onSubmit(data: UpdateBookingRulesInput) {
    try {
      await updateSettings.mutateAsync(data);
      toast.success('Booking rules updated');
    } catch (err) {
      reportMutationError('settings.booking_rules.update', err);
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
              <FormField
                control={form.control}
                name="advanceBookingDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Advance Booking Window (days)</FormLabel>
                    <FormControl>
                      <NumberInput {...field} />
                    </FormControl>
                    <FormDescription>How far in advance riders can book</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="bookingCutoffHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Booking Cutoff (hours)</FormLabel>
                    <FormControl>
                      <NumberInput {...field} />
                    </FormControl>
                    <FormDescription>Minimum hours before lesson start to book</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cancellationNoticeHours"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cancellation Notice (hours)</FormLabel>
                    <FormControl>
                      <NumberInput {...field} />
                    </FormControl>
                    <FormDescription>Hours before lesson to cancel without penalty</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="defaultLessonDurationMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Lesson Duration (min)</FormLabel>
                    <FormControl>
                      <NumberInput {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="bookingPaymentTimeoutMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Timeout (min)</FormLabel>
                    <FormControl>
                      <NumberInput min="1" max="60" {...field} />
                    </FormControl>
                    <FormDescription>
                      Minutes to wait before auto-cancelling a confirmed booking whose payment
                      never completed. Slot is released and rider is emailed. Range 1–60;
                      default 15.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lateCancellationFeePercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Late Cancellation Fee (%)</FormLabel>
                    <FormControl>
                      <NumberInput step="0.01" min="0" max="100" {...field} />
                    </FormControl>
                    <FormDescription>
                      Percentage of lesson price charged for late cancellations (0 = no fee)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="noShowFeePercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>No-Show Fee (%)</FormLabel>
                    <FormControl>
                      <NumberInput step="0.01" min="0" max="100" {...field} />
                    </FormControl>
                    <FormDescription>
                      Percentage of lesson price charged when a rider doesn&apos;t show up
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="defaultCalendarView"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Calendar View</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? 'week'}>
                    <FormControl>
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="day">Day</SelectItem>
                      <SelectItem value="week">Week</SelectItem>
                      <SelectItem value="month">Month</SelectItem>
                      <SelectItem value="agenda">Agenda</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex items-center gap-4">
              <FormField
                control={form.control}
                name="allowOverbooking"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2">
                    <FormLabel>Allow Overbooking</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              {form.watch('allowOverbooking') && (
                <FormField
                  control={form.control}
                  name="overbookingLimit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Overbooking Limit</FormLabel>
                      <FormControl>
                        <NumberInput className="w-20" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
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
