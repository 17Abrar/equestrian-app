'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Mail, Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  useUpdateSettings,
  type ClubSettings,
  type NotificationPreferences,
} from '@/hooks/use-settings';

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

export function NotificationsForm({ settings }: { settings: ClubSettings }) {
  const updateSettings = useUpdateSettings();
  const [prefs, setPrefs] = useState<NotificationPreferences>(
    settings.notificationPreferences ?? {},
  );

  function toggle(key: keyof NotificationPreferences, value: boolean) {
    setPrefs((current) => ({
      ...current,
      [key]: { email: value },
    }));
  }

  async function onSave() {
    try {
      await updateSettings.mutateAsync({ notificationPreferences: prefs });
      toast.success('Notification preferences saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save preferences');
    }
  }

  function isEnabled(key: keyof NotificationPreferences): boolean {
    return prefs[key]?.email ?? true;
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
      <CardContent className="space-y-6">
        <section>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Mail className="h-4 w-4 text-muted-foreground" />
            Sent to riders and owners
          </div>
          <div className="space-y-1 rounded-lg border">
            {riderTriggers.map((trigger, idx) => (
              <div key={trigger.key}>
                <TriggerRow
                  trigger={trigger}
                  enabled={isEnabled(trigger.key)}
                  onToggle={(v) => toggle(trigger.key, v)}
                />
                {idx < riderTriggers.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Bell className="h-4 w-4 text-muted-foreground" />
            Sent to club staff
          </div>
          <div className="space-y-1 rounded-lg border">
            {adminTriggers.map((trigger, idx) => (
              <div key={trigger.key}>
                <TriggerRow
                  trigger={trigger}
                  enabled={isEnabled(trigger.key)}
                  onToggle={(v) => toggle(trigger.key, v)}
                />
                {idx < adminTriggers.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={updateSettings.isPending}>
            {updateSettings.isPending ? 'Saving...' : 'Save preferences'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface TriggerRowProps {
  trigger: TriggerInfo;
  enabled: boolean;
  onToggle: (value: boolean) => void;
}

function TriggerRow({ trigger, enabled, onToggle }: TriggerRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{trigger.title}</p>
        <p className="text-xs text-muted-foreground">{trigger.description}</p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        aria-label={`Toggle ${trigger.title}`}
      />
    </div>
  );
}
