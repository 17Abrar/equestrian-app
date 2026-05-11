'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Mail, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form';
import {
  useUpdateSettings,
  type ClubSettings,
  type NotificationPreferences,
} from '@/hooks/use-settings';
import { reportMutationError } from '@/components/shared/report-mutation-error';

interface TriggerInfo {
  key: keyof NotificationPreferences;
  title: string;
  description: string;
  recipient: 'rider' | 'admin';
}

// Every trigger the platform can fire, grouped by audience. Kept in sync with
// the actual email-templates package and the sendEmail call sites in
// apps/web/app/api/v1/**; adding a new email should also add an entry here so
// clubs can opt out.
const TRIGGERS: TriggerInfo[] = [
  {
    key: 'booking_confirmation',
    title: 'Booking confirmation',
    description: 'Sent to a rider the moment a booking is confirmed.',
    recipient: 'rider',
  },
  {
    key: 'booking_reminder_24h',
    title: '24-hour reminder',
    description: 'Reminder to the rider one day before their lesson.',
    recipient: 'rider',
  },
  {
    key: 'booking_cancellation',
    title: 'Booking cancellation',
    description: 'Sent when a booking is cancelled by either party.',
    recipient: 'rider',
  },
  {
    key: 'waitlist_promotion',
    title: 'Waitlist promotion',
    description: 'Sent when a waitlisted rider gets promoted into a slot that opened up.',
    recipient: 'rider',
  },
  {
    key: 'payment_receipt',
    title: 'Payment receipt',
    description: 'Delivered after a successful lesson payment.',
    recipient: 'rider',
  },
  {
    key: 'payment_failed',
    title: 'Payment failed',
    description: 'Alert when a payment attempt is declined.',
    recipient: 'rider',
  },
  {
    key: 'rider_welcome',
    title: 'Rider welcome',
    description: 'Greets new riders the first time they join your club.',
    recipient: 'rider',
  },
  {
    key: 'invoice_issued',
    title: 'Invoice issued',
    description: 'Sent to owners / riders when a new invoice is created.',
    recipient: 'rider',
  },
  {
    key: 'feed_alert',
    title: 'Feed supply alert',
    description: 'Notifies club staff when a horse is running low on feed.',
    recipient: 'admin',
  },
  // Round 8 — horse ownership flow
  {
    key: 'horse_registration_submitted',
    title: 'Horse registration submitted',
    description: 'Alerts admins when a rider submits a horse for approval.',
    recipient: 'admin',
  },
  {
    key: 'horse_registration_approved',
    title: 'Horse registration approved',
    description: 'Confirms to the owner that their horse was approved, with the livery fee.',
    recipient: 'rider',
  },
  {
    key: 'horse_registration_declined',
    title: 'Horse registration declined',
    description: 'Lets the owner know their registration was declined, with the reason.',
    recipient: 'rider',
  },
  // Round 8.5 — livery billing
  {
    key: 'livery_invoice_issued',
    title: 'Livery invoice issued',
    description: 'Monthly livery invoice with a pay link, sent to the horse owner.',
    recipient: 'rider',
  },
  {
    key: 'livery_payment_received',
    title: 'Livery payment received',
    description: 'Receipt sent after a successful livery payment.',
    recipient: 'rider',
  },
  {
    key: 'livery_invoice_overdue',
    title: 'Livery invoice overdue',
    description: 'Reminder when a livery invoice is past due. Sent at 7, 14, and 30 days.',
    recipient: 'rider',
  },
];

// Audit F-30 (2026-05-07 r5): RHF schema. Each trigger key maps to a
// boolean (the `email` channel toggle). The save handler converts the
// flat `Record<string, boolean>` back into the nested
// `{ key: { email: value } }` shape the API expects.
const notificationsFormSchema = z.object(
  TRIGGERS.reduce<Record<string, z.ZodBoolean>>((acc, t) => {
    acc[t.key] = z.boolean();
    return acc;
  }, {}),
);
type NotificationsFormValues = Record<string, boolean>;

function prefsToFormValues(prefs: NotificationPreferences | undefined): NotificationsFormValues {
  return TRIGGERS.reduce<NotificationsFormValues>((acc, t) => {
    acc[t.key] = prefs?.[t.key]?.email ?? true;
    return acc;
  }, {});
}

function formValuesToPrefs(values: NotificationsFormValues): NotificationPreferences {
  const result: NotificationPreferences = {};
  for (const key of Object.keys(values)) {
    const triggerKey = key as keyof NotificationPreferences;
    result[triggerKey] = { email: values[key] ?? true };
  }
  return result;
}

export function NotificationsForm({ settings }: { settings: ClubSettings }) {
  const updateSettings = useUpdateSettings();

  const form = useForm<NotificationsFormValues>({
    resolver: zodResolver(notificationsFormSchema),
    defaultValues: prefsToFormValues(settings.notificationPreferences),
  });

  // Audit MED (2026-05-05 pass 2): the previous shape initialised `prefs`
  // from the prop ONCE — a parallel mutation that invalidated the cached
  // settings (e.g. another tab toggling preferences, or the discovery
  // form's optimistic refetch) updated the prop but left this `prefs`
  // stale. Toggling here would then write the *stale* state, silently
  // overwriting the just-saved values from the other path. The effect
  // resyncs whenever `settings.notificationPreferences` shifts. RHF's
  // `reset` is the correct way to re-seed a form from new props.
  useEffect(() => {
    form.reset(prefsToFormValues(settings.notificationPreferences));
    // form is a stable reference; re-running on prefs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.notificationPreferences]);

  async function onSave(values: NotificationsFormValues) {
    try {
      await updateSettings.mutateAsync({
        notificationPreferences: formValuesToPrefs(values),
      });
      toast.success('Notification preferences saved');
    } catch (err) {
      reportMutationError('settings.notifications.save', err);
      toast.error(err instanceof Error ? err.message : 'Failed to save preferences');
    }
  }

  const riderTriggers = TRIGGERS.filter((t) => t.recipient === 'rider');
  const adminTriggers = TRIGGERS.filter((t) => t.recipient === 'admin');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Notifications</CardTitle>
        <CardDescription>
          Turn individual automated emails on or off for your club. Transactional receipts stay
          available to riders via their booking history either way.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Mail className="text-muted-foreground h-4 w-4" />
                Sent to riders and owners
              </div>
              <div className="space-y-1 rounded-lg border">
                {riderTriggers.map((trigger, idx) => (
                  <div key={trigger.key}>
                    <TriggerRow form={form} trigger={trigger} />
                    {idx < riderTriggers.length - 1 && <Separator />}
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Bell className="text-muted-foreground h-4 w-4" />
                Sent to club staff
              </div>
              <div className="space-y-1 rounded-lg border">
                {adminTriggers.map((trigger, idx) => (
                  <div key={trigger.key}>
                    <TriggerRow form={form} trigger={trigger} />
                    {idx < adminTriggers.length - 1 && <Separator />}
                  </div>
                ))}
              </div>
            </section>

            <div className="flex justify-end">
              <Button type="submit" disabled={updateSettings.isPending}>
                {updateSettings.isPending ? 'Saving...' : 'Save preferences'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

interface TriggerRowProps {
  form: ReturnType<typeof useForm<NotificationsFormValues>>;
  trigger: TriggerInfo;
}

function TriggerRow({ form, trigger }: TriggerRowProps) {
  return (
    <FormField
      control={form.control}
      name={trigger.key}
      render={({ field }) => (
        <FormItem className="flex items-start justify-between gap-4 space-y-0 px-4 py-3">
          <div className="space-y-0.5">
            <FormLabel className="text-sm font-medium">{trigger.title}</FormLabel>
            <p className="text-muted-foreground text-xs">{trigger.description}</p>
          </div>
          <FormControl>
            <Switch
              checked={field.value}
              onCheckedChange={field.onChange}
              aria-label={`Toggle ${trigger.title}`}
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}
